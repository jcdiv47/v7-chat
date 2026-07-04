import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { StreamId } from "@convex-dev/persistent-text-streaming";
import { ANON_USER_ID, HEARTBEAT_STALE_MS } from "./lib/constants";
import { persistentTextStreaming } from "./lib/streaming";
import { runStatus } from "./schema";

/** Latest run for a thread — drives resume + composer state on the client. */
export const latestForThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .first();
    if (!run) return null;
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

/** Finalize a run: store the assistant message with full parts fidelity, patch
 * run metrics/status, touch the thread, and schedule stream cleanup. */
export const finish = internalMutation({
  args: {
    runId: v.id("runs"),
    status: runStatus,
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
    if (!run) return;

    const messageStatus =
      args.status === "completed"
        ? ("complete" as const)
        : args.status === "cancelled"
          ? ("cancelled" as const)
          : ("failed" as const);

    const now = Date.now();
    const assistantMessageId = await ctx.db.insert("messages", {
      threadId: run.threadId,
      userId: run.userId,
      role: "assistant",
      text: args.text,
      parts: args.parts,
      toolLines: args.toolLines,
      runId: args.runId,
      status: messageStatus,
      durationMs: Math.max(0, now - run.startedAt),
      createdAt: now,
    });

    await ctx.db.patch(args.runId, {
      status: args.status,
      finishedAt: Date.now(),
      finishReason: args.finishReason,
      error: args.error,
      usage: args.usage,
      modelId: args.modelId,
      stepCount: args.stepCount,
      toolCallCount: args.toolCallCount,
      sqlCount: args.sqlCount,
      loadedSkillNames: args.loadedSkillNames,
      assistantMessageId,
      stopRequested: false,
    });

    // Point this run's artifacts (saved before the message existed) at the message.
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
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

/** Sweeper: mark running runs with a stale heartbeat as failed. */
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
      await ctx.db.patch(run._id, {
        status: "failed",
        error: "Run heartbeat went stale; the server likely died mid-run.",
        finishedAt: Date.now(),
      });
    }
    return running.length;
  },
});
