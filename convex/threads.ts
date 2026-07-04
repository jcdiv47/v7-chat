import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { ANON_USER_ID } from "./lib/constants";
import { persistentTextStreaming } from "./lib/streaming";
import type { StreamId } from "@convex-dev/persistent-text-streaming";
import type { Id } from "./_generated/dataModel";

/** All threads for the current (anonymous) user, newest first. The client
 * splits pinned vs. recents and buckets recents by recency. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_user_updated", (q) => q.eq("userId", ANON_USER_ID))
      .order("desc")
      .collect();
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
 * and persistent streams. */
export const remove = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== ANON_USER_ID) return;
    await deleteThreadCascade(ctx, threadId);
  },
});

async function deleteThreadCascade(ctx: MutationCtx, threadId: Id<"threads">) {
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect();
  for (const m of messages) await ctx.db.delete(m._id);

  const artifacts = await ctx.db
    .query("artifacts")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect();
  for (const a of artifacts) await ctx.db.delete(a._id);

  const runs = await ctx.db
    .query("runs")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect();
  for (const run of runs) {
    const events = await ctx.db
      .query("runEvents")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    for (const e of events) await ctx.db.delete(e._id);
    try {
      await persistentTextStreaming.deleteStream(ctx, run.streamId as StreamId);
    } catch {
      // Stream already gone / compacted.
    }
    await ctx.db.delete(run._id);
  }

  await ctx.db.delete(threadId);
}
