import { and, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { threads } from "../../db/schema";
import { newId } from "../../runs-service";
import { publicProcedure, router } from "../trpc";

const toThreadSummary = (t: typeof threads.$inferSelect) => ({
  id: t.id,
  title: t.title,
  pinned: t.pinned,
  createdAt: t.createdAt.getTime(),
  updatedAt: t.updatedAt.getTime(),
});

export const threadsRouter = router({
  /** All threads for the current user, newest first. The client splits pinned
   * vs. recents and buckets recents by recency. */
  list: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(threads)
      .where(eq(threads.userId, ctx.userId))
      .orderBy(desc(threads.updatedAt))
      .limit(200);
    return rows.map(toThreadSummary);
  }),

  get: publicProcedure
    .input(z.object({ threadId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.threads.findFirst({
        where: and(eq(threads.id, input.threadId), eq(threads.userId, ctx.userId)),
      });
      return row ? toThreadSummary(row) : null;
    }),

  /** Title search for the ⌘K palette (SQL ILIKE; tsvector is the upgrade path). */
  search: publicProcedure
    .input(z.object({ query: z.string().max(200) }))
    .query(async ({ ctx, input }) => {
      const q = input.query.trim();
      if (!q) return [];
      const rows = await ctx.db
        .select()
        .from(threads)
        .where(
          and(
            eq(threads.userId, ctx.userId),
            ilike(threads.title, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
          ),
        )
        .orderBy(desc(threads.updatedAt))
        .limit(20);
      return rows.map(toThreadSummary);
    }),

  create: publicProcedure
    .input(z.object({ title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const id = newId();
      await ctx.db.insert(threads).values({
        id,
        userId: ctx.userId,
        title: input.title?.trim() || "New chat",
        pinned: false,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    }),

  rename: publicProcedure
    .input(z.object({ threadId: z.uuid(), title: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(threads)
        .set({
          title: input.title.trim().slice(0, 200) || "Untitled",
          updatedAt: new Date(),
        })
        .where(and(eq(threads.id, input.threadId), eq(threads.userId, ctx.userId)));
    }),

  setPinned: publicProcedure
    .input(z.object({ threadId: z.uuid(), pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(threads)
        .set({ pinned: input.pinned })
        .where(and(eq(threads.id, input.threadId), eq(threads.userId, ctx.userId)));
    }),

  /** Delete a thread and everything under it. The FK graph cascades: thread →
   * messages/runs, run → events/artifacts/chunks — one statement, no scheduler. */
  remove: publicProcedure
    .input(z.object({ threadId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(threads)
        .where(and(eq(threads.id, input.threadId), eq(threads.userId, ctx.userId)));
    }),
});
