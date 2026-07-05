/**
 * The write path of the streaming subsystem. Each JSONL line goes to two
 * places, synchronously: the RunBus (live subscribers see it immediately — the
 * hot path never touches the database) and an in-memory buffer flushed to
 * run_chunks as one batched INSERT when ≥250 ms elapsed, ≥32 KB buffered, or
 * the line is structural (step/tool boundaries). Seq increments per line, so
 * the SSE resume cursor is exact. See docs/specs/11 → Streaming Subsystem.
 */
import { getDb } from "./db/client";
import { runChunks } from "./db/schema";
import { getRunBus } from "./run-bus";

const FLUSH_INTERVAL_MS = 250;
const MAX_PENDING_CHARS = 32 * 1024;

export type ChunkWriter = {
  /** Publish + buffer one JSONL line (no trailing newline). */
  write(line: string, flush?: boolean): Promise<void>;
  /** Persist whatever is still buffered. */
  flush(): Promise<void>;
};

export function createChunkWriter(runId: string): ChunkWriter {
  const bus = getRunBus();
  let seq = 0;
  let pending: { seq: number; body: string }[] = [];
  let pendingChars = 0;
  let lastFlush = Date.now();

  const flush = async () => {
    if (pending.length === 0) return;
    const rows = pending.map((p) => ({
      runId,
      seq: p.seq,
      body: p.body,
      createdAt: new Date(),
    }));
    pending = [];
    pendingChars = 0;
    lastFlush = Date.now();
    // onConflictDoNothing: a duplicated drive of the same run (should not
    // happen — startRun dedupes) must not blow up the whole run on a PK clash.
    await getDb().insert(runChunks).values(rows).onConflictDoNothing();
  };

  return {
    async write(line: string, forceFlush = false) {
      seq += 1;
      bus.publish(runId, { type: "line", seq, line });
      pending.push({ seq, body: line });
      pendingChars += line.length;
      if (
        forceFlush ||
        Date.now() - lastFlush >= FLUSH_INTERVAL_MS ||
        pendingChars >= MAX_PENDING_CHARS
      ) {
        await flush();
      }
    },
    flush,
  };
}
