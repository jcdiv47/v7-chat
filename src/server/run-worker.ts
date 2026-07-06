/**
 * The chat agent loop, executed as an in-process fire-and-forget promise (the
 * app service is long-lived — no serverless time limits), so a run never
 * depends on any client connection. It runs the ToolLoopAgent (or the offline
 * demo), writes each UI message chunk through the chunk writer (RunBus + batched
 * run_chunks persistence), stamps a heartbeat + checks stop at each step
 * boundary, and finalizes the run by storing the assistant message with full
 * parts fidelity. Port of convex/agent/loop.ts. See docs/specs/11.
 */
import type { UIMessageChunk } from "ai";
import { eq } from "drizzle-orm";
import { buildModelMessages, type CompactTurn } from "../lib/agent/history";
import { buildInstructions } from "../lib/agent/instructions";
import { runAnalysisAgent, type RunAgentResult } from "../lib/agent/run";
import {
  buildToolLines,
  capPartsForStorage,
  reduceChunks,
  trimChunkForStream,
  type RenderTextPart,
} from "../lib/agent/stream-parts";
import { createAgentTools } from "../lib/agent/tools";
import { bundledSkillSource } from "../lib/skills/loader";
import {
  getModel,
  getModelId,
  hasRealModel,
  resolveModelDef,
} from "../lib/models/registry";
import type { AnalysisRuntimeContext, ModelAlias } from "../lib/agent/types";
import { MAX_STEPS, RUN_TIMEOUTS } from "./constants";
import { createChunkWriter } from "./chunk-writer";
import { getDb } from "./db/client";
import { messages as messagesTable, runs } from "./db/schema";
import { runDemoAnalysis } from "./demo";
import {
  appendEvent,
  finishRun,
  heartbeat,
  listHistoryTurns,
} from "./runs-service";
import { createWorkerDeps, newRunStats } from "./worker-deps";

type ActiveRun = { promise: Promise<void>; abort: AbortController };

type WorkerState = { active: Map<string, ActiveRun>; draining: boolean };

const globalStore = globalThis as unknown as { __v7RunWorker?: WorkerState };

function state(): WorkerState {
  return (globalStore.__v7RunWorker ??= { active: new Map(), draining: false });
}

export function isDraining(): boolean {
  return state().draining;
}

export function setDraining(): void {
  state().draining = true;
}

export function activeRuns(): Map<string, ActiveRun> {
  return state().active;
}

/**
 * Entry point from the send/edit/retry mutations (after their transaction
 * commits): fire-and-forget — errors are contained and finalized as failed
 * outcomes, never thrown into the caller.
 */
export function startRun(runId: string): void {
  const { active } = state();
  if (active.has(runId)) return; // duplicate start
  const abort = new AbortController();
  const promise = driveRun(runId, abort.signal)
    .catch((err) => {
      console.error(`[run-worker] run ${runId} crashed:`, err);
    })
    .finally(() => {
      active.delete(runId);
    });
  active.set(runId, { promise, abort });
}

async function driveRun(runId: string, abortSignal: AbortSignal): Promise<void> {
  const db = getDb();
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run || run.status !== "running") return;

  const writer = createChunkWriter(runId);
  const stats = newRunStats();
  const collected: UIMessageChunk[] = [];

  const onChunk = async (chunk: UIMessageChunk) => {
    const trimmed = trimChunkForStream(chunk);
    collected.push(trimmed);
    if (chunk.type === "tool-input-available") stats.toolCallCount += 1;
    // Structural chunks (tool rows, step/finish markers) flush immediately so
    // live viewers see them without waiting for the flush interval; deltas
    // (text, reasoning, tool input) are batched to keep write volume down.
    const isDelta =
      chunk.type === "text-delta" ||
      chunk.type === "reasoning-delta" ||
      chunk.type === "tool-input-delta";
    await writer.write(JSON.stringify(trimmed), !isDelta);
  };

  // Heartbeat + stop check at each step boundary.
  const beforeStep = async (_stepNumber: number): Promise<boolean> => {
    const hb = await heartbeat(runId);
    return !hb.stop;
  };

  const onEvent = async (event: {
    type: string;
    metadata: Record<string, unknown>;
  }) => {
    await appendEvent(db, {
      runId,
      threadId: run.threadId,
      type: event.type,
      metadata: event.metadata,
    });
  };

  const deps = createWorkerDeps({ runId, threadId: run.threadId, stats });

  const alias = run.modelAlias as ModelAlias;
  let result: RunAgentResult;

  try {
    if (!hasRealModel()) {
      // The demo script branches on the user's text (keyword triggers).
      const userMessage = run.userMessageId
        ? await db.query.messages.findFirst({
            where: eq(messagesTable.id, run.userMessageId),
          })
        : undefined;
      const demo = await runDemoAnalysis({
        onChunk,
        saveArtifact: deps.saveArtifact,
        beforeStep,
        userText: userMessage?.text,
      });
      result = { ...demo, usage: undefined, errorText: demo.errorText };
    } else {
      const turns: CompactTurn[] = await listHistoryTurns(run.threadId, {
        excludeRunId: runId,
        beforeAt: run.retryAnchorAt,
      });
      const messages = buildModelMessages(turns);
      const skills = bundledSkillSource.list();
      const def = resolveModelDef(alias);
      const runtimeContext: AnalysisRuntimeContext = {
        requestId: runId,
        runId,
        threadId: run.threadId,
        userId: run.userId,
        modelAlias: alias,
        activeSkillNames: run.activeSkillNames,
        loadedSkillNames: [],
        skillsVersion: run.skillsVersion,
      };
      result = await runAnalysisAgent({
        model: getModel(alias),
        temperature: def.temperature,
        maxOutputTokens: def.maxOutputTokens,
        reasoning: def.reasoning,
        instructions: buildInstructions(skills),
        messages,
        tools: createAgentTools(deps),
        maxSteps: MAX_STEPS,
        timeout: RUN_TIMEOUTS,
        runtimeContext,
        abortSignal,
        onChunk,
        onEvent,
        beforeStep,
      });
    }
  } catch (err) {
    result = {
      finishReason: "error",
      steps: 0,
      aborted: abortSignal.aborted,
      errorText: err instanceof Error ? err.message : String(err),
    };
  }

  const reduced = reduceChunks(collected);
  // Cap the stored parts so one pathological run can't balloon a message row;
  // tool lines keep full fidelity (they're tiny) so history compaction still
  // sees row counts.
  const parts = capPartsForStorage(reduced.parts);
  const finalText = parts
    .filter((p): p is RenderTextPart => p.kind === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trim();
  const toolLines = buildToolLines(reduced.parts);
  const errorText = result.errorText ?? reduced.errorText;

  const status: "completed" | "failed" | "cancelled" = result.aborted
    ? "cancelled"
    : errorText
      ? "failed"
      : "completed";

  // Surface an error to any live viewer if the run failed with no partial text.
  if (status === "failed" && errorText && !finalText) {
    await writer.write(JSON.stringify({ type: "error", errorText }));
  }
  await writer.flush();

  const assistantMessageId = await finishRun(runId, {
    status,
    text: finalText || (status === "cancelled" ? "_(stopped)_" : ""),
    parts,
    toolLines,
    finishReason: result.finishReason,
    error: errorText,
    usage: result.usage,
    modelId: hasRealModel() ? getModelId(alias) : "offline-demo",
    stepCount: result.steps,
    toolCallCount: stats.toolCallCount,
    sqlCount: stats.sqlCount,
    loadedSkillNames: [...stats.loadedSkills],
  });
  // Null means the run was already finalized (reclaimed as failed by the
  // sweeper or a new send while this executor looked stale) — the outcome on
  // record is that one, so don't log a bogus completion event on top of it.
  if (assistantMessageId == null) return;

  await appendEvent(db, {
    runId,
    threadId: run.threadId,
    type: status === "completed" ? "run.completed" : "run.failed",
    metadata: {
      status,
      finishReason: result.finishReason,
      steps: result.steps,
      sqlCount: stats.sqlCount,
      toolCallCount: stats.toolCallCount,
      loadedSkills: [...stats.loadedSkills],
      usage: result.usage,
      error: errorText,
    },
  });
}
