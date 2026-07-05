import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { messages, threads, type MessageRow } from "../../db/schema";
import { publicProcedure, router } from "../trpc";

const toMessage = (m: MessageRow) => ({
  id: m.id,
  threadId: m.threadId,
  role: m.role,
  text: m.text,
  parts: m.parts,
  toolLines: m.toolLines,
  runId: m.runId,
  status: m.status,
  durationMs: m.durationMs,
  createdAt: m.createdAt.getTime(),
});

export const messagesRouter = router({
  /** Messages for a thread, oldest first. Drives the conversation view. */
  list: publicProcedure
    .input(z.object({ threadId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const thread = await ctx.db.query.threads.findFirst({
        columns: { id: true },
        where: and(eq(threads.id, input.threadId), eq(threads.userId, ctx.userId)),
      });
      if (!thread) return [];
      const rows = await ctx.db
        .select()
        .from(messages)
        .where(eq(messages.threadId, input.threadId))
        .orderBy(asc(messages.createdAt));
      return rows.map(toMessage);
    }),

  /** A single message by id (for the artifact panel's Answer tab). */
  get: publicProcedure
    .input(z.object({ messageId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.messages.findFirst({
        where: and(eq(messages.id, input.messageId), eq(messages.userId, ctx.userId)),
      });
      return row ? toMessage(row) : null;
    }),
});
