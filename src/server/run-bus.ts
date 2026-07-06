/**
 * In-memory pub/sub for live run output: the worker publishes each JSONL line
 * (with the seq it will persist under) and a terminal "end" signal; stream
 * subscriptions deliver them to clients without touching the database.
 *
 * The bus also retains a per-run backlog of every published line for as long
 * as the run is live. Subscribers replay from the backlog, which closes the
 * gap a DB replay has: lines sitting in the chunk writer's flush buffer are
 * already here, so a client that connects mid-buffer misses nothing. The DB
 * (run_chunks) is only the replay source when no backlog exists — i.e. after
 * a process restart, right before the sweeper reclaims the run.
 *
 * One process ⇒ in-memory suffices; with >1 replica this swaps for Redis
 * pub/sub behind the same interface. See docs/specs/01-system-architecture.md.
 */
export type RunBusEvent =
  | { type: "line"; seq: number; line: string }
  | { type: "end" };

type Listener = (event: RunBusEvent) => void;

/** Keep a finished run's backlog around briefly so subscribers that raced the
 * finalize can still drain it before it disappears. */
const BACKLOG_TTL_AFTER_END_MS = 60_000;

type Topic = {
  listeners: Set<Listener>;
  backlog: { seq: number; line: string }[];
  ended: boolean;
};

class RunBus {
  private topics = new Map<string, Topic>();

  private topic(runId: string): Topic {
    let t = this.topics.get(runId);
    if (!t) {
      t = { listeners: new Set(), backlog: [], ended: false };
      this.topics.set(runId, t);
    }
    return t;
  }

  subscribe(runId: string, listener: Listener): () => void {
    const t = this.topic(runId);
    t.listeners.add(listener);
    return () => {
      t.listeners.delete(listener);
      if (t.listeners.size === 0 && t.ended) this.topics.delete(runId);
    };
  }

  /** All retained lines with seq > afterSeq, or null if this process has no
   * backlog for the run (restarted — fall back to run_chunks). */
  backlogAfter(
    runId: string,
    afterSeq: number,
  ): { seq: number; line: string }[] | null {
    const t = this.topics.get(runId);
    if (!t || (t.backlog.length === 0 && !t.ended)) return null;
    return t.backlog.filter((l) => l.seq > afterSeq);
  }

  publish(runId: string, event: RunBusEvent): void {
    const t = this.topic(runId);
    if (event.type === "line") {
      t.backlog.push({ seq: event.seq, line: event.line });
    } else {
      t.ended = true;
      const timer = setTimeout(() => {
        // Drop the retained lines; live listeners (if any) keep their queues.
        if (this.topics.get(runId) === t) this.topics.delete(runId);
      }, BACKLOG_TTL_AFTER_END_MS);
      timer.unref?.();
    }
    for (const listener of [...t.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not take down the publisher (agent loop).
      }
    }
  }
}

const globalStore = globalThis as unknown as { __v7RunBus?: RunBus };

export function getRunBus(): RunBus {
  return (globalStore.__v7RunBus ??= new RunBus());
}
