import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { StreamId } from "@convex-dev/persistent-text-streaming";
import { ANON_USER_ID, HEARTBEAT_STALE_MS } from "./lib/constants";
import { persistentTextStreaming } from "./lib/streaming";
import {
  buildToolLines,
  capPartsForStorage,
  parseStreamBody,
  reduceChunks,
  type RenderTextPart,
} from "../src/lib/agent/stream-parts";

/** Latest run for a thread — drives resume + composer state on the client. */
export const latestForThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .first();
    if (!run || run.userId !== ANON_USER_ID) return null;
    return {
      _id: run._id,
      status: run.status,
      streamId: run.streamId,
      stopRequested: run.stopRequested ?? false,
      heartbeatAt: run.heartbeatAt,
      staleThresholdMs: HEARTBEAT_STALE_MS,
      modelAlias: run.modelAlias,
      error: run.error,
      assistantMessageId: run.assistantMessageId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
  },
});

export const get = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.userId !== ANON_USER_ID) return null;
    return run;
  },
});

/** User pressed stop. The loop checks this at each step boundary. */
export const requestStop = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.userId !== ANON_USER_ID) return;
    if (run.status === "running") {
      await ctx.db.patch(runId, { stopRequested: true });
    }
  },
});

// --- internal (loop / sweeper) ---------------------------------------------

export const getByStream = internalQuery({
  args: { streamId: v.string() },
  handler: async (ctx, { streamId }) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_stream", (q) => q.eq("streamId", streamId))
      .first();
  },
});

/** Stamp the heartbeat and report whether the loop should stop. Called at every
 * step boundary. */
export const heartbeat = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return { stop: true, status: "cancelled" as const };
    if (run.status !== "running") return { stop: true, status: run.status };
    await ctx.db.patch(runId, { heartbeatAt: Date.now() });
    return { stop: run.stopRequested === true, status: run.status };
  },
});

type RunOutcome = {
  status: "completed" | "failed" | "cancelled";
  text: string;
  parts: unknown[];
  toolLines: string[];
  finishReason?: string;
  error?: string;
  usage?: unknown;
  modelId?: string;
  stepCount?: number;
  toolCallCount?: number;
  sqlCount?: number;
  loadedSkillNames: string[];
};

/** Shared finalization: store the assistant message with full parts fidelity,
 * patch run metrics/status, touch the thread, and schedule stream cleanup.
 * Used by the loop's `finish` and by interrupted-run reclamation. */
async function storeRunOutcome(
  ctx: MutationCtx,
  run: Doc<"runs">,
  outcome: RunOutcome,
) {
  const messageStatus =
    outcome.status === "completed"
      ? ("complete" as const)
      : outcome.status === "cancelled"
        ? ("cancelled" as const)
        : ("failed" as const);

  const now = Date.now();
  const assistantMessageId = await ctx.db.insert("messages", {
    threadId: run.threadId,
    userId: run.userId,
    role: "assistant",
    text: outcome.text,
    parts: outcome.parts,
    toolLines: outcome.toolLines,
    runId: run._id,
    status: messageStatus,
    durationMs: Math.max(0, now - run.startedAt),
    createdAt: now,
  });

  await ctx.db.patch(run._id, {
    status: outcome.status,
    finishedAt: Date.now(),
    finishReason: outcome.finishReason,
    error: outcome.error,
    usage: outcome.usage,
    modelId: outcome.modelId,
    stepCount: outcome.stepCount,
    toolCallCount: outcome.toolCallCount,
    sqlCount: outcome.sqlCount,
    loadedSkillNames: outcome.loadedSkillNames,
    assistantMessageId,
    stopRequested: false,
  });

  // Point this run's artifacts (saved before the message existed) at the message.
  const artifacts = await ctx.db
    .query("artifacts")
    .withIndex("by_run", (q) => q.eq("runId", run._id))
    .collect();
  for (const a of artifacts) {
    if (!a.messageId) await ctx.db.patch(a._id, { messageId: assistantMessageId });
  }

  await ctx.db.patch(run.threadId, { updatedAt: Date.now() });

  // Streams are transient: clean up shortly after the final message is stored.
  await ctx.scheduler.runAfter(60_000, internal.runs.cleanupStream, {
    streamId: run.streamId,
  });

  return assistantMessageId;
}

/**
 * Reclaim a run whose executor died (stale heartbeat / crashed action): store a
 * failed assistant message built from whatever partial output made it into the
 * persisted stream, so the run leaves a visible trace instead of vanishing.
 * No-op unless the run is still `running`.
 */
export async function finalizeInterruptedRun(
  ctx: MutationCtx,
  run: Doc<"runs">,
  error: string,
) {
  if (run.status !== "running") return;

  let parts: unknown[] = [];
  let toolLines: string[] = [];
  let text = "";
  try {
    const body = await persistentTextStreaming.getStreamBody(
      ctx,
      run.streamId as StreamId,
    );
    const reduced = reduceChunks(parseStreamBody(body.text));
    const capped = capPartsForStorage(reduced.parts);
    parts = capped;
    toolLines = buildToolLines(reduced.parts);
    text = capped
      .filter((p): p is RenderTextPart => p.kind === "text")
      .map((p) => p.text)
      .join("\n\n")
      .trim();
  } catch {
    // Stream already deleted or unreadable — finalize with no partial output.
  }

  await storeRunOutcome(ctx, run, {
    status: "failed",
    text,
    parts,
    toolLines,
    error,
    loadedSkillNames: run.loadedSkillNames,
  });
}

/** Finalize a run from the agent loop. */
export const finish = internalMutation({
  args: {
    runId: v.id("runs"),
    // A finished run is never "running" — narrower than the schema's runStatus.
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    text: v.string(),
    parts: v.array(v.any()),
    toolLines: v.array(v.string()),
    finishReason: v.optional(v.string()),
    error: v.optional(v.string()),
    usage: v.optional(v.any()),
    modelId: v.optional(v.string()),
    stepCount: v.optional(v.number()),
    toolCallCount: v.optional(v.number()),
    sqlCount: v.optional(v.number()),
    loadedSkillNames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    // Only a still-running run may be finalized. If the sweeper or a new send
    // already reclaimed it (stale heartbeat), storing a second outcome would
    // insert a duplicate assistant message and overwrite the terminal status.
    if (!run || run.status !== "running") return null;
    const { runId: _runId, ...outcome } = args;
    return await storeRunOutcome(ctx, run, outcome);
  },
});

export const cleanupStream = internalMutation({
  args: { streamId: v.string() },
  handler: async (ctx, { streamId }) => {
    try {
      await persistentTextStreaming.deleteStream(ctx, streamId as StreamId);
    } catch {
      // Already deleted / compacted.
    }
  },
});

/** Sweeper: finalize running runs with a stale heartbeat as failed, keeping
 * whatever partial output reached the stream as a visible assistant message. */
export const sweepStaleRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - HEARTBEAT_STALE_MS;
    const running = await ctx.db
      .query("runs")
      .withIndex("by_status_heartbeat", (q) =>
        q.eq("status", "running").lt("heartbeatAt", cutoff),
      )
      .collect();
    for (const run of running) {
      await finalizeInterruptedRun(
        ctx,
        run,
        "Run heartbeat went stale; the server likely died mid-run.",
      );
    }
    return running.length;
  },
});
