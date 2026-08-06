import { and, desc, eq, exists, sql } from "drizzle-orm";
import { z } from "zod";
import { runs, searchTerms, threads } from "../../db/schema";
import { newId } from "../../runs-service";
import {
  buildTitleTermMatch,
  replaceThreadTitleSearchTerms,
  THREAD_TITLE_SOURCE,
} from "../../search/title-index";
import { publicProcedure, router } from "../trpc";

type ThreadSummaryRow = Pick<
  typeof threads.$inferSelect,
  "id" | "title" | "pinned" | "createdAt" | "updatedAt"
>;

const toThreadSummary = (t: ThreadSummaryRow, running = false) => ({
  id: t.id,
  title: t.title,
  pinned: t.pinned,
  createdAt: t.createdAt.getTime(),
  updatedAt: t.updatedAt.getTime(),
  /** Whether this thread currently has a live run — drives the sidebar
   * spinner. At most one per thread (see the one_live_run_per_thread index). */
  running,
});

export const threadsRouter = router({
  /** All threads for the current user, newest first. The client splits pinned
   * vs. recents and buckets recents by recency. */
  list: publicProcedure.query(async ({ ctx }) => {
    // Correlated EXISTS via the query builder so the column refs are
    // table-qualified (a raw sql`` template renders them unqualified, which
    // silently self-joins runs and always reads false). Cheap thanks to the
    // one_live_run_per_thread partial index.
    const running = exists(
      ctx.db
        .select({ one: sql`1` })
        .from(runs)
        .where(and(eq(runs.threadId, threads.id), eq(runs.status, "running"))),
    );
    const rows = await ctx.db
      .select({
        id: threads.id,
        title: threads.title,
        pinned: threads.pinned,
        createdAt: threads.createdAt,
        updatedAt: threads.updatedAt,
        running,
      })
      .from(threads)
      .where(eq(threads.userId, ctx.userId))
      .orderBy(desc(threads.updatedAt))
      .limit(200);
    return rows.map((r) => toThreadSummary(r, Boolean(r.running)));
  }),

  get: publicProcedure
    .input(z.object({ threadId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.threads.findFirst({
        where: and(eq(threads.id, input.threadId), eq(threads.userId, ctx.userId)),
      });
      return row ? toThreadSummary(row) : null;
    }),

  /** Title search for the ⌘K palette. Matches app-managed search_terms —
   * English words by prefix (so it narrows as you type) and Chinese bigrams
   * exactly — so standard Postgres is enough. */
  search: publicProcedure
    .input(z.object({ query: z.string().max(200) }))
    .query(async ({ ctx, input }) => {
      const termMatch = buildTitleTermMatch(input.query);
      if (!termMatch) return [];
      const matchCount = sql<number>`count(*)::int`;
      const rows = await ctx.db
        .select({
          id: threads.id,
          title: threads.title,
          pinned: threads.pinned,
          createdAt: threads.createdAt,
          updatedAt: threads.updatedAt,
          matchCount,
        })
        .from(searchTerms)
        .innerJoin(
          threads,
          and(eq(threads.id, searchTerms.threadId), eq(threads.userId, ctx.userId)),
        )
        .where(
          and(
            eq(searchTerms.userId, ctx.userId),
            eq(searchTerms.sourceKind, THREAD_TITLE_SOURCE),
            termMatch,
          ),
        )
        .groupBy(
          threads.id,
          threads.title,
          threads.pinned,
          threads.createdAt,
          threads.updatedAt,
        )
        .orderBy(desc(matchCount), desc(threads.updatedAt))
        .limit(20);
      return rows.map((r) => toThreadSummary(r));
    }),

  create: publicProcedure
    .input(z.object({ title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const id = newId();
      const title = input.title?.trim() || "New chat";
      await ctx.db.transaction(async (tx) => {
        await tx.insert(threads).values({
          id,
          userId: ctx.userId,
          title,
          pinned: false,
          createdAt: now,
          updatedAt: now,
        });
        await replaceThreadTitleSearchTerms(tx, {
          userId: ctx.userId,
          threadId: id,
          title,
        });
      });
      return id;
    }),

  rename: publicProcedure
    .input(z.object({ threadId: z.uuid(), title: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const title = input.title.trim().slice(0, 200) || "Untitled";
      await ctx.db.transaction(async (tx) => {
        const [thread] = await tx
          .update(threads)
          .set({
            title,
            updatedAt: new Date(),
          })
          .where(and(eq(threads.id, input.threadId), eq(threads.userId, ctx.userId)))
          .returning({ id: threads.id });
        if (!thread) return;
        await replaceThreadTitleSearchTerms(tx, {
          userId: ctx.userId,
          threadId: input.threadId,
          title,
        });
      });
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
