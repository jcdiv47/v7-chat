import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { artifacts, runs } from "../../db/schema";
import { publicProcedure, router } from "../trpc";

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
});
