/**
 * Liveness hardening (docs/specs/11 → Liveness, stop, drain):
 * - Sweeper: every 60 s, finalize `running` runs whose heartbeat went stale
 *   (server died mid-run), preserving partial output as a visible failed
 *   message — port of the Convex cron.
 * - Drain: on SIGTERM/SIGINT, stop accepting new runs, give in-flight runs a
 *   grace window to finish, then abort them (the loop finalizes with partial
 *   output) and finalize anything left. Requires NEXT_MANUAL_SIG_HANDLE=true
 *   in production so Next.js doesn't exit before the drain completes.
 */
import { and, eq, lt } from "drizzle-orm";
import { HEARTBEAT_STALE_MS } from "./constants";
import { getDb, getPool } from "./db/client";
import { runs } from "./db/schema";
import { finalizeInterruptedRun, publishRunEnd } from "./runs-service";
import { activeRuns, isDraining, setDraining } from "./run-worker";

const SWEEP_INTERVAL_MS = 60_000;

/** Finalize one stale run under a row lock (re-checking status + staleness so
 * we never clobber a run that finished or heartbeat in the meantime). */
async function reclaimStaleRun(
  runId: string,
  error: string,
  opts?: { force?: boolean },
): Promise<boolean> {
  const db = getDb();
  const reclaimed = await db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update");
    if (!run || run.status !== "running") return false;
    const fresh =
      run.heartbeatAt != null &&
      Date.now() - run.heartbeatAt.getTime() <= HEARTBEAT_STALE_MS;
    if (fresh && !opts?.force) return false;
    await finalizeInterruptedRun(tx, run, error);
    return true;
  });
  if (reclaimed) publishRunEnd(runId);
  return reclaimed;
}

export async function sweepStaleRuns(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - HEARTBEAT_STALE_MS);
  const stale = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.status, "running"), lt(runs.heartbeatAt, cutoff)));
  let count = 0;
  for (const run of stale) {
    if (
      await reclaimStaleRun(
        run.id,
        "Run heartbeat went stale; the server likely died mid-run.",
      )
    ) {
      count += 1;
    }
  }
  return count;
}

export function startSweeper(): void {
  const timer = setInterval(() => {
    sweepStaleRuns().catch((err) => console.error("[sweeper] sweep failed:", err));
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function settleActive(timeoutMs: number): Promise<void> {
  const promises = [...activeRuns().values()].map((a) => a.promise);
  if (promises.length === 0) return;
  await Promise.race([Promise.allSettled(promises), sleep(timeoutMs)]);
}

export async function drainAndExit(signalName: string): Promise<void> {
  if (isDraining()) return;
  setDraining();
  const grace = Number(process.env.DRAIN_GRACE_MS ?? 25_000);
  const active = activeRuns();
  console.log(
    `[drain] ${signalName}: ${active.size} in-flight run(s), grace ${grace}ms`,
  );

  // 1. Let in-flight runs finish naturally within the grace window.
  await settleActive(grace);

  // 2. Abort survivors: the loop's abort path flushes buffered chunks and
  // finalizes with partial output preserved.
  if (active.size > 0) {
    for (const { abort } of active.values()) abort.abort();
    await settleActive(5_000);
  }

  // 3. Anything still marked running from this process gets the same visible
  // failure a stale heartbeat produces, but with no lost chunks.
  for (const runId of [...active.keys()]) {
    await reclaimStaleRun(
      runId,
      "The server restarted while this run was in progress.",
      { force: true },
    ).catch((err) => console.error(`[drain] finalize ${runId} failed:`, err));
  }

  await getPool()
    .end()
    .catch(() => undefined);
  console.log("[drain] complete");
  process.exit(0);
}
