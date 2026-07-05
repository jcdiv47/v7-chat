import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { runEvents, runs } from "../../db/schema";
import { publicProcedure, router } from "../trpc";

export const eventsRouter = router({
  /** Run events for the developer/debug "Run Events" tab. */
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
        .from(runEvents)
        .where(eq(runEvents.runId, input.runId))
        .orderBy(asc(runEvents.createdAt));
      return rows.map((e) => ({
        id: e.id,
        type: e.type,
        metadata: e.metadata,
        createdAt: e.createdAt.getTime(),
      }));
    }),
});
