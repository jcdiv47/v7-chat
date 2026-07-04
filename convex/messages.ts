import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { ANON_USER_ID } from "./lib/constants";

/** Messages for a thread, oldest first. Drives the conversation view. */
export const list = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.userId !== ANON_USER_ID) return [];
    return await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("asc")
      .collect();
  },
});

/** A single message by id (for the artifact panel's Answer tab). */
export const get = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message || message.userId !== ANON_USER_ID) return null;
    return message;
  },
});

/** Prior turns for history compaction, used by the agent loop. Returns only the
 * fields needed to rebuild model messages (role, text, one-line tool summaries).
 * Excludes any assistant message tied to the currently running run. */
export const history = internalQuery({
  args: {
    threadId: v.id("threads"),
    excludeRunId: v.optional(v.id("runs")),
    beforeAt: v.optional(v.number()),
  },
  handler: async (ctx, { threadId, excludeRunId, beforeAt }) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .order("asc")
      .collect();
    return messages
      .filter((m) => !(excludeRunId && m.runId === excludeRunId))
      .filter((m) => beforeAt == null || m.createdAt <= beforeAt)
      .map((m) => ({
        role: m.role,
        text: m.text,
        // A cancelled turn's text carries none of what its tools returned, so
        // its tool summaries would tell the model it already did work whose
        // results are not in context — a recipe for hallucinated recall.
        toolLines: m.status === "cancelled" ? [] : (m.toolLines ?? []),
      }));
  },
});
