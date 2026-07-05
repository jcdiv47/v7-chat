/**
 * The chat agent loop, executed in a scheduled internal action (V8 runtime) so
 * a run never depends on any client connection. It runs the ToolLoopAgent (or
 * the offline demo), appends each UI message chunk as JSONL to the persistent
 * stream (which clients read via the reactive `stream.getBody` subscription),
 * stamps a heartbeat + checks stop at each step boundary, and finalizes the run
 * by storing the assistant message with full parts fidelity. See docs/specs/01, 02.
 */
import type { UIMessageChunk } from "ai";
import { components, internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { MAX_STEPS } from "../lib/constants";
import { createWebDeps, newRunStats } from "./webDeps";
import { runDemoAnalysis } from "./demo";
import { buildModelMessages, type CompactTurn } from "../../src/lib/agent/history";
import { buildInstructions } from "../../src/lib/agent/instructions";
import { createAgentTools } from "../../src/lib/agent/tools";
import { runAnalysisAgent, type RunAgentResult } from "../../src/lib/agent/run";
import {
  buildToolLines,
  capPartsForStorage,
  reduceChunks,
  trimChunkForStream,
  type RenderTextPart,
} from "../../src/lib/agent/stream-parts";
import { bundledSkillSource } from "../../src/lib/skills/loader";
import {
  getModel,
  getModelId,
  hasRealModel,
  resolveModelDef,
} from "../../src/lib/models/registry";
import type { AnalysisRuntimeContext, ModelAlias } from "../../src/lib/agent/types";

/** Flush the pending buffer at most this often. Every flush is an `addChunk`
 * mutation, and each one makes the reactive `getBody` subscription re-read the
 * whole accumulated body — total read bandwidth is quadratic in chunk count —
 * so fewer, larger chunks matter far more than low latency here. */
const FLUSH_INTERVAL_MS = 250;

/** Don't let a long run of deltas grow the buffer unboundedly between flushes. */
const MAX_PENDING_CHARS = 8192;

/**
 * Entry point from the scheduled drive action. Replicates the
 * persistent-text-streaming writer without an HTTP request: append chunks via
 * the component's public mutations (pending → streaming → done), and mark the
 * stream errored if the agent throws.
 */
export async function runAgentDetached(
  ctx: ActionCtx,
  streamId: string,
): Promise<void> {
  const lib = components.persistentTextStreaming.lib;
  const status = await ctx.runQuery(lib.getStreamStatus, { streamId });
  if (status !== "pending") return; // already driven (duplicate schedule)

  let pending = "";
  let lastFlush = Date.now();
  const append = async (text: string, flush = false) => {
    pending += text;
    const now = Date.now();
    if (
      flush ||
      now - lastFlush >= FLUSH_INTERVAL_MS ||
      pending.length >= MAX_PENDING_CHARS
    ) {
      await ctx.runMutation(lib.addChunk, { streamId, text: pending, final: false });
      pending = "";
      lastFlush = now;
    }
  };

  try {
    await runAgentForStream(ctx, streamId, append);
    await ctx.runMutation(lib.addChunk, { streamId, text: pending, final: true });
  } catch (err) {
    await ctx
      .runMutation(lib.setStreamStatus, { streamId, status: "error" })
      .catch(() => undefined);
    throw err;
  }
}

async function runAgentForStream(
  ctx: ActionCtx,
  streamId: string,
  append: (text: string, flush?: boolean) => Promise<void>,
): Promise<void> {
  const run = await ctx.runQuery(internal.runs.getByStream, { streamId });
  if (!run || run.status !== "running") return;

  const stats = newRunStats();
  const collected: UIMessageChunk[] = [];

  const onChunk = async (chunk: UIMessageChunk) => {
    const trimmed = trimChunkForStream(chunk);
    collected.push(trimmed);
    if (chunk.type === "tool-input-available") stats.toolCallCount += 1;
    // Structural chunks (tool rows, step/finish markers) flush immediately so
    // live viewers see them without waiting for the flush interval; deltas
    // (text, reasoning, tool input) are batched to keep the chunk count down.
    const isDelta =
      chunk.type === "text-delta" ||
      chunk.type === "reasoning-delta" ||
      chunk.type === "tool-input-delta";
    await append(JSON.stringify(trimmed) + "\n", !isDelta);
  };

  // Heartbeat + stop check at each step boundary.
  const beforeStep = async (_stepNumber: number): Promise<boolean> => {
    const hb = await ctx.runMutation(internal.runs.heartbeat, { runId: run._id });
    return !hb.stop;
  };

  const onEvent = async (event: {
    type: string;
    metadata: Record<string, unknown>;
  }) => {
    await ctx.runMutation(internal.events.append, {
      runId: run._id,
      threadId: run.threadId,
      type: event.type,
      metadata: event.metadata,
    });
  };

  const deps = createWebDeps(ctx, {
    runId: run._id,
    threadId: run.threadId,
    stats,
  });

  const alias = run.modelAlias as ModelAlias;
  let result: RunAgentResult;

  try {
    if (!hasRealModel()) {
      const demo = await runDemoAnalysis({
        onChunk,
        saveArtifact: deps.saveArtifact,
        beforeStep,
      });
      result = { ...demo, usage: undefined, errorText: demo.errorText };
    } else {
      const turns = (await ctx.runQuery(internal.messages.history, {
        threadId: run.threadId,
        excludeRunId: run._id,
        beforeAt: run.retryAnchorAt,
      })) as CompactTurn[];
      const messages = buildModelMessages(turns);
      const skills = bundledSkillSource.list();
      const def = resolveModelDef(alias);
      const runtimeContext: AnalysisRuntimeContext = {
        requestId: streamId,
        runId: run._id,
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
        instructions: buildInstructions(skills),
        messages,
        tools: createAgentTools(deps),
        maxSteps: MAX_STEPS,
        runtimeContext,
        onChunk,
        onEvent,
        beforeStep,
      });
    }
  } catch (err) {
    result = {
      finishReason: "error",
      steps: 0,
      aborted: false,
      errorText: err instanceof Error ? err.message : String(err),
    };
  }

  const reduced = reduceChunks(collected);
  // Cap the stored parts under the Convex document limit; tool lines keep full
  // fidelity (they're tiny) so history compaction still sees row counts.
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
    await append(JSON.stringify({ type: "error", errorText }) + "\n");
  }

  const assistantMessageId = await ctx.runMutation(internal.runs.finish, {
    runId: run._id,
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

  await ctx.runMutation(internal.events.append, {
    runId: run._id,
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
