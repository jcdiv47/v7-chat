import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { ANON_USER_ID } from "./lib/constants";

/** Append a lifecycle event (docs/specs/06 → Convex Run Records). */
export const append = internalMutation({
  args: {
    runId: v.id("runs"),
    threadId: v.id("threads"),
    type: v.string(),
    metadata: v.any(),
  },
  handler: async (ctx, { runId, threadId, type, metadata }) => {
    await ctx.db.insert("runEvents", {
      runId,
      threadId,
      type,
      metadata: metadata ?? {},
      createdAt: Date.now(),
    });
  },
});

/** Run events for the developer/debug "Run Events" tab. */
export const listForRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.userId !== ANON_USER_ID) return [];
    return await ctx.db
      .query("runEvents")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .order("asc")
      .collect();
  },
});
