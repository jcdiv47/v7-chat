/**
 * The chat agent loop, executed inside the persistent-text-streaming writer of
 * the chat HTTP action (V8 runtime). It runs the ToolLoopAgent (or the offline
 * demo), appends each UI message chunk as JSONL to the stream, stamps a
 * heartbeat + checks stop at each step boundary, and finalizes the run by
 * storing the assistant message with full parts fidelity. See docs/specs/01, 02.
 */
import type { StreamId } from "@convex-dev/persistent-text-streaming";
import type { UIMessageChunk } from "ai";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { MAX_STEPS } from "../lib/constants";
import { persistentTextStreaming } from "../lib/streaming";
import { createWebDeps, newRunStats } from "./webDeps";
import { runDemoAnalysis } from "./demo";
import { buildModelMessages, type CompactTurn } from "../../src/lib/agent/history";
import { buildInstructions } from "../../src/lib/agent/instructions";
import { createAgentTools } from "../../src/lib/agent/tools";
import { runAnalysisAgent, type RunAgentResult } from "../../src/lib/agent/run";
import {
  reduceChunks,
  toolLabel,
  trimChunkForStream,
  type RenderPart,
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

/** Entry point from the HTTP action. Wraps the agent in the persistent stream. */
export async function runChatStream(
  ctx: ActionCtx,
  request: Request,
  streamId: string,
): Promise<Response> {
  const response = await persistentTextStreaming.stream(
    // The component types its ctx as the generic data model; capture the typed
    // outer ctx in the writer closure instead of the generic one it passes back.
    ctx as unknown as GenericActionCtx<GenericDataModel>,
    request,
    streamId as StreamId,
    async (_streamCtx, _req, _sid, append) => {
      await runAgentForStream(ctx, streamId, append);
    },
  );
  // The endpoint lives on *.convex.site; allow the Next.js origin to read it.
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Vary", "Origin");
  return response;
}

async function runAgentForStream(
  ctx: ActionCtx,
  streamId: string,
  append: (text: string) => Promise<void>,
): Promise<void> {
  const run = await ctx.runQuery(internal.runs.getByStream, { streamId });
  if (!run || run.status !== "running") return;

  const stats = newRunStats();
  const collected: UIMessageChunk[] = [];

  const onChunk = async (chunk: UIMessageChunk) => {
    const trimmed = trimChunkForStream(chunk);
    collected.push(trimmed);
    if (chunk.type === "tool-input-available") stats.toolCallCount += 1;
    await append(JSON.stringify(trimmed) + "\n");
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
        userText: "",
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
  const finalText = reduced.parts
    .filter((p): p is RenderTextPart => p.kind === "text")
    .map((p) => p.text)
    .join("")
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

  await ctx.runMutation(internal.runs.finish, {
    runId: run._id,
    status,
    text: finalText || (status === "cancelled" ? "_(stopped)_" : ""),
    parts: reduced.parts,
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

/** One-line tool summaries for history compaction (name, SQL, row count). */
function buildToolLines(parts: RenderPart[]): string[] {
  const lines: string[] = [];
  for (const part of parts) {
    if (part.kind !== "tool") continue;
    if (part.name === "runSql") {
      const input = (part.input ?? {}) as { sql?: string };
      const output = (part.output ?? {}) as { rowCount?: number };
      const sql = (input.sql ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      const rows =
        typeof output.rowCount === "number" ? ` (rows: ${output.rowCount})` : "";
      lines.push(`runSql: ${sql}${rows}`);
    } else {
      lines.push(toolLabel(part));
    }
  }
  return lines;
}
