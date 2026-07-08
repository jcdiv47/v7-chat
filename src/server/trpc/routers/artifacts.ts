import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { artifacts, runs, threads, type ArtifactRow } from "../../db/schema";
import { publicProcedure, router } from "../trpc";

/** One entry per run: lightweight counts for the assistant-response artifact
 * affordances. No payloads — table artifacts can carry large result previews,
 * so those are fetched only for the run open in the panel (`listForRun`).
 *
 * `messageId` is part of the summary contract (docs/specs/05-frontend-ux.md →
 * ArtifactSummaryViewModel) for message-keyed consumers/visibility. The current
 * panel is opened by `runId` and keys its map by `runId`, so it does not read
 * `messageId` yet; it is carried for that documented shape and future
 * message-anchored affordances (e.g. scroll-to-message). */
type ArtifactSummary = {
  runId: string;
  messageId: string | null;
  total: number;
  counts: Partial<Record<ArtifactRow["type"], number>>;
  latestCreatedAt: number;
};

export const artifactsRouter = router({
  /** Artifacts for one run (the artifact panel opened from a message). */
  listForRun: publicProcedure
    .input(z.object({ runId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        columns: { id: true },
        where: and(eq(runs.id, input.runId), eq(runs.userId, ctx.userId)),
      });
      if (!run) return [];
      const rows = await ctx.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.runId, input.runId))
        .orderBy(asc(artifacts.createdAt));
      return rows.map((a) => ({
        id: a.id,
        runId: a.runId,
        threadId: a.threadId,
        messageId: a.messageId,
        type: a.type,
        title: a.title,
        payload: a.payload,
        createdAt: a.createdAt.getTime(),
      }));
    }),

  /**
   * Lightweight per-run artifact counts for one thread. Drives the
   * assistant-response artifact affordances (badge/visibility) without pulling
   * full payloads for every message. One row per run, keyed by `runId` on the
   * client. See docs/specs/07-implementation-plan.md → Phase 6A.
   */
  summaryForThread: publicProcedure
    .input(z.object({ threadId: z.uuid() }))
    .query(async ({ ctx, input }): Promise<ArtifactSummary[]> => {
      // Ownership: confirm the thread is the user's, then scope by threadId.
      // Every artifact carries its thread, so this is airtight without a join.
      const thread = await ctx.db.query.threads.findFirst({
        columns: { id: true },
        where: and(eq(threads.id, input.threadId), eq(threads.userId, ctx.userId)),
      });
      if (!thread) return [];

      const rows = await ctx.db
        .select({
          runId: artifacts.runId,
          type: artifacts.type,
          // A run yields one assistant message, so messageId is consistent
          // within a run; artifacts saved before finalize carry null. Cast to
          // text: Postgres has no max() aggregate for the uuid type.
          messageId: sql<string | null>`max(${artifacts.messageId}::text)`,
          count: sql<number>`count(*)::int`,
          latestCreatedAt: sql<string>`max(${artifacts.createdAt})`,
        })
        .from(artifacts)
        .where(eq(artifacts.threadId, input.threadId))
        .groupBy(artifacts.runId, artifacts.type);

      const byRun = new Map<string, ArtifactSummary>();
      for (const r of rows) {
        let s = byRun.get(r.runId);
        if (!s) {
          s = { runId: r.runId, messageId: null, total: 0, counts: {}, latestCreatedAt: 0 };
          byRun.set(r.runId, s);
        }
        s.counts[r.type] = r.count;
        s.total += r.count;
        const ts = new Date(r.latestCreatedAt).getTime();
        if (ts > s.latestCreatedAt) s.latestCreatedAt = ts;
        if (r.messageId && !s.messageId) s.messageId = r.messageId;
      }
      return [...byRun.values()];
    }),

  /** One artifact by id (DataView fetching a view's result rows). Same
   * ownership check as listForRun, joined through the owning run. */
  get: publicProcedure
    .input(z.object({ artifactId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ artifact: artifacts })
        .from(artifacts)
        .innerJoin(runs, eq(runs.id, artifacts.runId))
        .where(and(eq(artifacts.id, input.artifactId), eq(runs.userId, ctx.userId)));
      if (!row) return null;
      const a = row.artifact;
      return {
        id: a.id,
        runId: a.runId,
        threadId: a.threadId,
        messageId: a.messageId,
        type: a.type,
        title: a.title,
        payload: a.payload,
        createdAt: a.createdAt.getTime(),
      };
    }),
});
