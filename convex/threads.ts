import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ANON_USER_ID } from "./lib/constants";
import { persistentTextStreaming } from "./lib/streaming";
import type { StreamId } from "@convex-dev/persistent-text-streaming";

/** All threads for the current (anonymous) user, newest first. The client
 * splits pinned vs. recents and buckets recents by recency. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_user_updated", (q) => q.eq("userId", ANON_USER_ID))
      .order("desc")
      .take(200);
    return threads.map((t) => ({
      _id: t._id,
      title: t.title,
      pinned: t.pinned,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  },
});

export const get = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== ANON_USER_ID) return null;
    return thread;
  },
});

export const create = mutation({
  args: { title: v.optional(v.string()) },
  handler: async (ctx, { title }) => {
    const now = Date.now();
    return await ctx.db.insert("threads", {
      userId: ANON_USER_ID,
      title: title?.trim() || "New chat",
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const rename = mutation({
  args: { threadId: v.id("threads"), title: v.string() },
  handler: async (ctx, { threadId, title }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== ANON_USER_ID) return;
    await ctx.db.patch(threadId, {
      title: title.trim().slice(0, 200) || "Untitled",
      updatedAt: Date.now(),
    });
  },
});

export const setPinned = mutation({
  args: { threadId: v.id("threads"), pinned: v.boolean() },
  handler: async (ctx, { threadId, pinned }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== ANON_USER_ID) return;
    await ctx.db.patch(threadId, { pinned });
  },
});

/** Cascade-delete a thread and all of its messages, runs, events, artifacts,
 * and persistent streams. The thread doc is deleted immediately (so it leaves
 * the sidebar right away); the cascade runs in batched follow-up mutations so
 * a long-lived thread can't blow the transaction read/write limits. */
export const remove = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== ANON_USER_ID) return;
    await ctx.db.delete(threadId);
    await ctx.scheduler.runAfter(0, internal.threads.cascadeDelete, { threadId });
  },
});

const CASCADE_BATCH = 200;
const CASCADE_RUN_BATCH = 20;

/** One bounded slice of the cascade; reschedules itself until everything under
 * the (already deleted) thread is gone. */
export const cascadeDelete = internalMutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const reschedule = () =>
      ctx.scheduler.runAfter(0, internal.threads.cascadeDelete, { threadId });

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .take(CASCADE_BATCH);
    for (const m of messages) await ctx.db.delete(m._id);
    if (messages.length === CASCADE_BATCH) {
      await reschedule();
      return;
    }

    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .take(CASCADE_BATCH);
    for (const a of artifacts) await ctx.db.delete(a._id);
    if (artifacts.length === CASCADE_BATCH) {
      await reschedule();
      return;
    }

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .take(CASCADE_RUN_BATCH);
    for (const run of runs) {
      const events = await ctx.db
        .query("runEvents")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .take(CASCADE_BATCH);
      for (const e of events) await ctx.db.delete(e._id);
      if (events.length === CASCADE_BATCH) {
        // This run still has more events; keep it for the next slice.
        await reschedule();
        return;
      }
      try {
        await persistentTextStreaming.deleteStream(ctx, run.streamId as StreamId);
      } catch {
        // Stream already gone / compacted.
      }
      await ctx.db.delete(run._id);
    }
    if (runs.length === CASCADE_RUN_BATCH) await reschedule();
  },
});
