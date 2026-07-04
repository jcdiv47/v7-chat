import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { ANON_USER_ID } from "./lib/constants";
import { artifactType } from "./schema";

/** Save an analysis artifact (SQL, table, chartSpec, finding, error). */
export const save = internalMutation({
  args: {
    runId: v.id("runs"),
    threadId: v.id("threads"),
    type: artifactType,
    title: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { runId, threadId, type, title, payload }) => {
    return await ctx.db.insert("artifacts", {
      runId,
      threadId,
      type,
      title,
      payload: payload ?? {},
      createdAt: Date.now(),
    });
  },
});

/** All artifacts for a thread (the Artifacts nav view). */
export const listForThread = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== ANON_USER_ID) return [];
    return await ctx.db
      .query("artifacts")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .collect();
  },
});

/** Artifacts for one run (the artifact panel opened from a message). */
export const listForRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.userId !== ANON_USER_ID) return [];
    return await ctx.db
      .query("artifacts")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .order("asc")
      .collect();
  },
});
