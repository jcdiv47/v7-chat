/**
 * Run lifecycle helpers shared by the tRPC routers, the worker, and the
 * sweeper: heartbeat/stop, outcome storage, interrupted-run reclamation, and
 * the transactional one-live-run-per-thread claim. See
 * docs/specs/02-agent-runtime.md.
 */
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { CompactTurn } from "../lib/agent/history";
import {
  buildToolLines,
  capPartsForStorage,
  parseStreamBody,
  reduceChunks,
  type RenderTextPart,
} from "../lib/agent/stream-parts";
import { HEARTBEAT_STALE_MS } from "./constants";
import { getDb, type Db } from "./db/client";
import {
  artifacts,
  messages,
  runChunks,
  runEvents,
  runs,
  threads,
  type RunRow,
} from "./db/schema";
import { getRunBus } from "./run-bus";

/** Time-ordered UUIDv7 ids for every row. */
export const newId = (): string => uuidv7();

/** A transaction handle or the root db — every helper here accepts either. */
export type Dbx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export function deriveTitle(text: string): string {
  const firstLine = text.split("\n")[0].trim();
  return (firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine) || "New chat";
}

/** Tell live subscribers the run is over. Call after the finalizing
 * transaction commits, never inside it. */
export function publishRunEnd(runId: string): void {
  getRunBus().publish(runId, { type: "end" });
}

export async function appendEvent(
  dbx: Dbx,
  event: {
    runId: string;
    threadId: string;
    type: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await dbx.insert(runEvents).values({
    id: newId(),
    runId: event.runId,
    threadId: event.threadId,
    type: event.type,
    metadata: event.metadata ?? {},
    createdAt: new Date(),
  });
}

export async function saveArtifact(
  dbx: Dbx,
  artifact: {
    runId: string;
    threadId: string;
    type: "sql" | "table" | "chartSpec" | "view" | "finding" | "error";
    title: string;
    payload: Record<string, unknown>;
  },
): Promise<string> {
  const id = newId();
  await dbx.insert(artifacts).values({
    id,
    runId: artifact.runId,
    threadId: artifact.threadId,
    type: artifact.type,
    title: artifact.title,
    payload: artifact.payload ?? {},
    createdAt: new Date(),
  });
  return id;
}

/** Stamp the heartbeat and report whether the loop should stop. Called at every
 * step boundary and mid-step from tool deps. */
export async function heartbeat(
  runId: string,
): Promise<{ stop: boolean; status: RunRow["status"] }> {
  const db = getDb();
  const [row] = await db
    .update(runs)
    .set({ heartbeatAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.status, "running")))
    .returning({ stopRequested: runs.stopRequested });
  if (!row) {
    const run = await db.query.runs.findFirst({
      columns: { status: true },
      where: eq(runs.id, runId),
    });
    return { stop: true, status: run?.status ?? "cancelled" };
  }
  return { stop: row.stopRequested, status: "running" };
}

export type RunOutcome = {
  status: "completed" | "failed" | "cancelled";
  text: string;
  parts: unknown[];
  toolLines: string[];
  finishReason?: string;
  error?: string;
  usage?: unknown;
  modelId?: string;
  stepCount?: number;
  toolCallCount?: number;
  sqlCount?: number;
  loadedSkillNames: string[];
};

/** Shared finalization: store the assistant message with full parts fidelity,
 * patch run metrics/status, point artifacts at the message, touch the thread,
 * and drop the now-transient stream chunks. Used by the worker's finish and by
 * interrupted-run reclamation. Callers publishRunEnd after committing. */
export async function storeRunOutcome(
  dbx: Dbx,
  run: RunRow,
  outcome: RunOutcome,
): Promise<string> {
  const messageStatus =
    outcome.status === "completed"
      ? ("complete" as const)
      : outcome.status === "cancelled"
        ? ("cancelled" as const)
        : ("failed" as const);

  const now = new Date();
  const assistantMessageId = newId();
  await dbx.insert(messages).values({
    id: assistantMessageId,
    threadId: run.threadId,
    userId: run.userId,
    role: "assistant",
    text: outcome.text,
    parts: outcome.parts,
    toolLines: outcome.toolLines,
    runId: run.id,
    status: messageStatus,
    durationMs: Math.max(0, now.getTime() - run.startedAt.getTime()),
    createdAt: now,
  });

  await dbx
    .update(runs)
    .set({
      status: outcome.status,
      finishedAt: new Date(),
      finishReason: outcome.finishReason,
      error: outcome.error,
      usage: outcome.usage,
      modelId: outcome.modelId,
      stepCount: outcome.stepCount,
      toolCallCount: outcome.toolCallCount,
      sqlCount: outcome.sqlCount,
      loadedSkillNames: outcome.loadedSkillNames,
      assistantMessageId,
      stopRequested: false,
    })
    .where(eq(runs.id, run.id));

  // Point this run's artifacts (saved before the message existed) at the message.
  await dbx
    .update(artifacts)
    .set({ messageId: assistantMessageId })
    .where(and(eq(artifacts.runId, run.id), isNull(artifacts.messageId)));

  await dbx
    .update(threads)
    .set({ updatedAt: new Date() })
    .where(eq(threads.id, run.threadId));

  // The stream is transient; the finalized message now carries the parts.
  await dbx.delete(runChunks).where(eq(runChunks.runId, run.id));

  return assistantMessageId;
}

/**
 * Reclaim a run whose executor died (stale heartbeat / crashed worker /
 * deploy): store a failed assistant message built from whatever partial output
 * made it into run_chunks, so the run leaves a visible trace instead of
 * vanishing. No-op unless the run is still `running`. Runs inside the caller's
 * transaction; the caller publishes the end signal after commit.
 */
export async function finalizeInterruptedRun(
  dbx: Dbx,
  run: RunRow,
  error: string,
): Promise<void> {
  if (run.status !== "running") return;

  let parts: unknown[] = [];
  let toolLines: string[] = [];
  let text = "";
  try {
    const chunkRows = await dbx
      .select({ body: runChunks.body })
      .from(runChunks)
      .where(eq(runChunks.runId, run.id))
      .orderBy(asc(runChunks.seq));
    const body = chunkRows.map((c) => c.body).join("\n") + "\n";
    const reduced = reduceChunks(parseStreamBody(body));
    const capped = capPartsForStorage(reduced.parts);
    parts = capped;
    toolLines = buildToolLines(reduced.parts);
    text = capped
      .filter((p): p is RenderTextPart => p.kind === "text")
      .map((p) => p.text)
      .join("\n\n")
      .trim();
  } catch {
    // Chunks unreadable — finalize with no partial output.
  }

  await storeRunOutcome(dbx, run, {
    status: "failed",
    text,
    parts,
    toolLines,
    error,
    loadedSkillNames: run.loadedSkillNames,
  });
}

/** Finalize a run from the worker. Only a still-running run may be finalized:
 * if the sweeper or a new send already reclaimed it (stale heartbeat), storing
 * a second outcome would insert a duplicate assistant message and overwrite
 * the terminal status. Returns the assistant message id, or null if the run
 * was already finalized elsewhere. */
export async function finishRun(
  runId: string,
  outcome: RunOutcome,
): Promise<string | null> {
  const db = getDb();
  const id = await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(runs)
      .where(eq(runs.id, runId))
      .for("update");
    if (!run || run.status !== "running") return null;
    return await storeRunOutcome(tx, run, outcome);
  });
  publishRunEnd(runId);
  return id;
}

/**
 * Enforce one live run per thread inside the send/edit/retry transaction.
 * Locks the thread row (serializing claims per thread), then checks the
 * latest run: running-and-fresh → reject; running-and-stale → the server died
 * mid-run, so reclaim it inline (failed, partial output kept) so the user can
 * start immediately. The one_live_run_per_thread partial unique index
 * backstops any race that slips through. Returns the finalized-stale run id
 * (so the caller can publish its end signal after commit), if any.
 */
export async function claimThreadForRun(
  tx: Dbx,
  threadId: string,
): Promise<{ reclaimedRunId: string | null; latestRun: RunRow | null }> {
  const [latestRun] = await tx
    .select()
    .from(runs)
    .where(eq(runs.threadId, threadId))
    .orderBy(desc(runs.startedAt))
    .limit(1)
    .for("update");

  if (!latestRun || latestRun.status !== "running") {
    return { reclaimedRunId: null, latestRun: latestRun ?? null };
  }

  const fresh =
    latestRun.heartbeatAt != null &&
    Date.now() - latestRun.heartbeatAt.getTime() <= HEARTBEAT_STALE_MS;
  if (fresh) {
    throw new Error("A run is already in progress for this thread. Stop it first.");
  }
  await finalizeInterruptedRun(
    tx,
    latestRun,
    "Run heartbeat went stale; the server likely died mid-run.",
  );
  return { reclaimedRunId: latestRun.id, latestRun };
}

/** Prior turns for history compaction, used by the worker. Returns only the
 * fields needed to rebuild model messages. Excludes any assistant message tied
 * to the currently running run. */
export async function listHistoryTurns(
  threadId: string,
  opts: { excludeRunId?: string; beforeAt?: Date | null },
): Promise<CompactTurn[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.threadId, threadId),
        opts.beforeAt != null ? lte(messages.createdAt, opts.beforeAt) : undefined,
      ),
    )
    .orderBy(asc(messages.createdAt));
  return rows
    .filter((m) => !(opts.excludeRunId && m.runId === opts.excludeRunId))
    .map((m) => ({
      role: m.role,
      text: m.text,
      // A cancelled turn's text carries none of what its tools returned, so
      // its tool summaries would tell the model it already did work whose
      // results are not in context — a recipe for hallucinated recall.
      toolLines: m.status === "cancelled" ? [] : (m.toolLines ?? []),
    }));
}
