import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  ANON_USER_ID,
  DEFAULT_MODEL_ALIAS,
  HEARTBEAT_STALE_MS,
} from "./lib/constants";
import { persistentTextStreaming } from "./lib/streaming";
import { bundledSkillSource } from "../src/lib/skills/loader";

const modelAliasValidator = v.union(
  v.literal("fast"),
  v.literal("analyst"),
  v.literal("sql"),
  v.literal("summarizer"),
);

/**
 * Enforce one live run per thread. A run only blocks a new one while it is
 * genuinely alive (fresh heartbeat). A running-but-stale run means the server
 * died mid-run: reclaim it (mark failed) so the user can start/retry
 * immediately, matching the client's staleness check instead of waiting for the
 * cron sweeper (see runs.sweepStaleRuns).
 */
async function ensureNoLiveRun(ctx: MutationCtx, latestRun: Doc<"runs"> | null) {
  if (!latestRun || latestRun.status !== "running") return;
  const fresh =
    latestRun.heartbeatAt != null &&
    Date.now() - latestRun.heartbeatAt <= HEARTBEAT_STALE_MS;
  if (fresh) {
    throw new Error(
      "A run is already in progress for this thread. Stop it first.",
    );
  }
  await ctx.db.patch(latestRun._id, {
    status: "failed",
    error: "Run heartbeat went stale; the server likely died mid-run.",
    finishedAt: Date.now(),
    stopRequested: false,
  });
}

function deriveTitle(text: string): string {
  const firstLine = text.split("\n")[0].trim();
  return (firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine) || "New chat";
}

/**
 * Store the user message, create the run + persistent stream, and return the
 * stream ID so the client can start the chat HTTP action. Enforces one live run
 * per thread. Does not run the agent — that happens in the HTTP action.
 */
export const sendMessage = mutation({
  args: {
    threadId: v.optional(v.id("threads")),
    text: v.string(),
    modelAlias: v.optional(modelAliasValidator),
  },
  handler: async (ctx, { threadId, text, modelAlias }) => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Message is empty.");
    const now = Date.now();

    // Resolve or create the thread.
    let tid = threadId ?? null;
    if (tid) {
      const thread = await ctx.db.get(tid);
      if (!thread || thread.userId !== ANON_USER_ID) {
        throw new Error("Thread not found.");
      }
    } else {
      tid = await ctx.db.insert("threads", {
        userId: ANON_USER_ID,
        title: deriveTitle(trimmed),
        pinned: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    // One run per thread at a time.
    const latestRun = await ctx.db
      .query("runs")
      .withIndex("by_thread", (q) => q.eq("threadId", tid!))
      .order("desc")
      .first();
    await ensureNoLiveRun(ctx, latestRun);

    const userMessageId = await ctx.db.insert("messages", {
      threadId: tid,
      userId: ANON_USER_ID,
      role: "user",
      text: trimmed,
      createdAt: now,
    });

    // Name a fresh thread after its first message.
    const priorMessages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", tid!))
      .collect();
    const existingThread = await ctx.db.get(tid);
    if (priorMessages.length === 1 && existingThread?.title === "New chat") {
      await ctx.db.patch(tid, { title: deriveTitle(trimmed) });
    }

    // Create the persistent stream (source of truth for live output).
    const streamId = await persistentTextStreaming.createStream(ctx);
    const alias = modelAlias ?? DEFAULT_MODEL_ALIAS;

    const runId = await ctx.db.insert("runs", {
      threadId: tid,
      userId: ANON_USER_ID,
      streamId,
      status: "running",
      stopRequested: false,
      heartbeatAt: now,
      modelAlias: alias,
      skillsVersion: bundledSkillSource.version,
      activeSkillNames: bundledSkillSource.list().map((s) => s.name),
      loadedSkillNames: [],
      userMessageId,
      startedAt: now,
    });

    await ctx.db.patch(tid, { updatedAt: now });
    await ctx.runMutation(internal.events.append, {
      runId,
      threadId: tid,
      type: "run.started",
      metadata: { modelAlias: alias, userMessageId },
    });

    return { threadId: tid, runId, streamId, userMessageId };
  },
});

/**
 * Edit a user message and rerun from that point: every message after the edited
 * one is discarded (along with artifacts produced by those discarded turns),
 * then a new run regenerates the answer. History fed to the model is anchored
 * at the edited turn via retryAnchorAt, same as retryLast.
 */
export const editAndRerun = mutation({
  args: {
    messageId: v.id("messages"),
    text: v.string(),
    modelAlias: v.optional(modelAliasValidator),
  },
  handler: async (ctx, { messageId, text, modelAlias }) => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Message is empty.");

    const message = await ctx.db.get(messageId);
    if (!message || message.userId !== ANON_USER_ID || message.role !== "user") {
      throw new Error("Message not found.");
    }
    const threadId = message.threadId;
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== ANON_USER_ID) {
      throw new Error("Thread not found.");
    }

    const latestRun = await ctx.db
      .query("runs")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .first();
    await ensureNoLiveRun(ctx, latestRun);

    // Discard everything after the edited message. gte + skip-self also catches
    // a follower stamped with the same createdAt, which retryAnchorAt's <=
    // comparison would otherwise leak into the model history.
    for (;;) {
      const batch = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) =>
          q.eq("threadId", threadId).gte("createdAt", message.createdAt),
        )
        .take(100);
      const doomed = batch.filter((m) => m._id !== messageId);
      if (doomed.length === 0) break;
      for (const m of doomed) await ctx.db.delete(m._id);
    }

    // Artifacts from discarded turns were all created after the edited message
    // (one live run per thread means earlier turns' runs finished before it).
    for (;;) {
      const stale = await ctx.db
        .query("artifacts")
        .withIndex("by_thread", (q) =>
          q.eq("threadId", threadId).gt("createdAt", message.createdAt),
        )
        .take(100);
      if (stale.length === 0) break;
      for (const a of stale) await ctx.db.delete(a._id);
    }

    await ctx.db.patch(messageId, { text: trimmed });

    // Keep the thread title in sync when its first message is edited.
    const firstMessage = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("asc")
      .first();
    if (firstMessage?._id === messageId) {
      await ctx.db.patch(threadId, { title: deriveTitle(trimmed) });
    }

    const now = Date.now();
    const streamId = await persistentTextStreaming.createStream(ctx);
    const alias = modelAlias ?? latestRun?.modelAlias ?? DEFAULT_MODEL_ALIAS;

    const runId = await ctx.db.insert("runs", {
      threadId,
      userId: ANON_USER_ID,
      streamId,
      status: "running",
      stopRequested: false,
      heartbeatAt: now,
      modelAlias: alias,
      skillsVersion: bundledSkillSource.version,
      activeSkillNames: bundledSkillSource.list().map((s) => s.name),
      loadedSkillNames: [],
      userMessageId: messageId,
      retryAnchorAt: message.createdAt,
      startedAt: now,
    });

    await ctx.db.patch(threadId, { updatedAt: now });
    await ctx.runMutation(internal.events.append, {
      runId,
      threadId,
      type: "run.started",
      metadata: { modelAlias: alias, edit: true, userMessageId: messageId },
    });

    return { threadId, runId, streamId };
  },
});

/**
 * Retry: start a new run that regenerates the answer to the most recent user
 * message. The previous assistant response stays in history; the new run's model
 * context is anchored at that user turn so it does not see the old answer.
 */
export const retryLast = mutation({
  args: {
    threadId: v.id("threads"),
    modelAlias: v.optional(modelAliasValidator),
  },
  handler: async (ctx, { threadId, modelAlias }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== ANON_USER_ID) throw new Error("Thread not found.");

    const latestRun = await ctx.db
      .query("runs")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .first();
    await ensureNoLiveRun(ctx, latestRun);

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .collect();
    const lastUser = messages.find((m) => m.role === "user");
    if (!lastUser) throw new Error("Nothing to retry.");

    const now = Date.now();
    const streamId = await persistentTextStreaming.createStream(ctx);
    const alias = modelAlias ?? latestRun?.modelAlias ?? DEFAULT_MODEL_ALIAS;

    const runId = await ctx.db.insert("runs", {
      threadId,
      userId: ANON_USER_ID,
      streamId,
      status: "running",
      stopRequested: false,
      heartbeatAt: now,
      modelAlias: alias,
      skillsVersion: bundledSkillSource.version,
      activeSkillNames: bundledSkillSource.list().map((s) => s.name),
      loadedSkillNames: [],
      userMessageId: lastUser._id,
      retryAnchorAt: lastUser.createdAt,
      startedAt: now,
    });

    await ctx.db.patch(threadId, { updatedAt: now });
    await ctx.runMutation(internal.events.append, {
      runId,
      threadId,
      type: "run.started",
      metadata: { modelAlias: alias, retry: true },
    });

    return { threadId, runId, streamId };
  },
});
