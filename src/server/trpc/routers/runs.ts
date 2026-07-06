import { tracked } from "@trpc/server";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { HEARTBEAT_STALE_MS } from "../../constants";
import { getDb } from "../../db/client";
import { runChunks, runs, type RunRow } from "../../db/schema";
import { getRunBus, type RunBusEvent } from "../../run-bus";
import { publicProcedure, router } from "../trpc";

const toRunSummary = (run: RunRow) => ({
  id: run.id,
  status: run.status,
  stopRequested: run.stopRequested,
  heartbeatAt: run.heartbeatAt?.getTime() ?? null,
  staleThresholdMs: HEARTBEAT_STALE_MS,
  modelAlias: run.modelAlias,
  error: run.error,
  assistantMessageId: run.assistantMessageId,
  startedAt: run.startedAt.getTime(),
  finishedAt: run.finishedAt?.getTime() ?? null,
});

const toRunDetail = (run: RunRow) => ({
  ...toRunSummary(run),
  threadId: run.threadId,
  modelId: run.modelId,
  skillsVersion: run.skillsVersion,
  activeSkillNames: run.activeSkillNames,
  loadedSkillNames: run.loadedSkillNames,
  userMessageId: run.userMessageId,
  finishReason: run.finishReason,
  stepCount: run.stepCount,
  toolCallCount: run.toolCallCount,
  sqlCount: run.sqlCount,
  usage: run.usage,
});

/** How many replayed lines are grouped into one SSE event during catch-up, so
 * a refresh mid-run doesn't cost thousands of client renders. */
const REPLAY_BATCH_LINES = 200;

/** Backstop poll: if the end signal was somehow missed, re-check the run row
 * so a subscription can't hang open forever. */
const STATUS_RECHECK_MS = 15_000;

async function runStatus(runId: string): Promise<RunRow["status"] | null> {
  const run = await getDb().query.runs.findFirst({
    columns: { status: true },
    where: eq(runs.id, runId),
  });
  return run?.status ?? null;
}

/**
 * The live stream read path (docs/specs/01-system-architecture.md): replay
 * persisted chunks after the cursor, then tail the RunBus, deduping the
 * overlap by seq. Yields batches of JSONL lines as tracked SSE events whose id
 * is the last line's seq — so httpSubscriptionLink's automatic reconnect
 * resumes from the right cursor for free.
 */
async function* streamRun(
  runId: string,
  afterSeq: number,
  signal: AbortSignal | undefined,
) {
  const db = getDb();
  const bus = getRunBus();

  // Subscribe before the replay query so nothing published in between is lost;
  // the seq cursor dedupes the overlap.
  const queue: RunBusEvent[] = [];
  let notify: (() => void) | null = null;
  const unsubscribe = bus.subscribe(runId, (event) => {
    queue.push(event);
    notify?.();
  });
  const onAbort = () => notify?.();
  signal?.addEventListener("abort", onAbort);

  try {
    // 1. Catch-up replay — incremental, never a whole-body re-read. The bus
    // backlog is the source of truth for a run live in this process (it also
    // covers lines still sitting in the writer's flush buffer, which the DB
    // does not have yet); run_chunks is the fallback after a process restart.
    let lastSeq = afterSeq;
    let replay = bus.backlogAfter(runId, afterSeq);
    if (replay == null) {
      const rows = await db
        .select({ seq: runChunks.seq, body: runChunks.body })
        .from(runChunks)
        .where(and(eq(runChunks.runId, runId), gt(runChunks.seq, afterSeq)))
        .orderBy(asc(runChunks.seq));
      replay = rows.map((r) => ({ seq: r.seq, line: r.body }));
    }
    for (let i = 0; i < replay.length; i += REPLAY_BATCH_LINES) {
      const batch = replay.slice(i, i + REPLAY_BATCH_LINES);
      lastSeq = batch[batch.length - 1].seq;
      yield tracked(String(lastSeq), batch.map((r) => r.line));
    }

    // 2. If the run is already over, there is nothing to tail. (A finalized
    // run has its chunks deleted; clients read the message row instead.)
    const status = await runStatus(runId);
    if (status !== "running") return;

    // 3. Live tail.
    let lastRecheck = Date.now();
    while (!signal?.aborted) {
      while (queue.length > 0) {
        const event = queue.shift()!;
        if (event.type === "end") return;
        if (event.seq > lastSeq) {
          lastSeq = event.seq;
          yield tracked(String(event.seq), [event.line]);
        }
      }
      await new Promise<void>((resolve) => {
        notify = resolve;
        const timer = setTimeout(resolve, STATUS_RECHECK_MS);
        // Avoid keeping the process alive just for this poll.
        timer.unref?.();
      });
      notify = null;
      if (queue.length === 0 && Date.now() - lastRecheck >= STATUS_RECHECK_MS) {
        lastRecheck = Date.now();
        if ((await runStatus(runId)) !== "running") return;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    unsubscribe();
  }
}

export const runsRouter = router({
  /** Latest run for a thread — drives resume + composer state on the client. */
  latestForThread: publicProcedure
    .input(z.object({ threadId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const [run] = await ctx.db
        .select()
        .from(runs)
        .where(eq(runs.threadId, input.threadId))
        .orderBy(desc(runs.startedAt))
        .limit(1);
      if (!run || run.userId !== ctx.userId) return null;
      return toRunSummary(run);
    }),

  get: publicProcedure
    .input(z.object({ runId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.runs.findFirst({
        where: and(eq(runs.id, input.runId), eq(runs.userId, ctx.userId)),
      });
      return run ? toRunDetail(run) : null;
    }),

  /** User pressed stop. The loop checks this at each step boundary. */
  stop: publicProcedure
    .input(z.object({ runId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(runs)
        .set({ stopRequested: true })
        .where(
          and(
            eq(runs.id, input.runId),
            eq(runs.userId, ctx.userId),
            eq(runs.status, "running"),
          ),
        );
    }),

  /**
   * Live run output as an SSE subscription. Events carry batches of JSONL
   * lines (UIMessageChunk per line); the event id is the seq cursor, so
   * reconnects resume via lastEventId. Keyed only by the unguessable runId
   * after the tRPC context has required a signed-in user.
   */
  stream: publicProcedure
    .input(
      z.object({
        runId: z.uuid(),
        lastEventId: z.string().nullish(),
      }),
    )
    .subscription(async function* ({ input, signal }) {
      const afterSeq = input.lastEventId ? Number(input.lastEventId) || 0 : 0;
      yield* streamRun(input.runId, afterSeq, signal);
    }),
});
