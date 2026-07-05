"use client";

import { useRef, useState } from "react";
import type { UIMessageChunk } from "ai";
import { trpc } from "@/lib/trpc";
import {
  createStreamReducer,
  type ReducedMessage,
  type StreamReducer,
} from "@/lib/agent/stream-parts";

const EMPTY: ReducedMessage = { parts: [], finished: false, aborted: false };

export type RunStream = {
  reduced: ReducedMessage;
  streamStatus: "streaming" | "done" | "error";
};

/**
 * Subscribe to a run's live output over the tRPC SSE subscription. Runs are
 * driven server-side by the in-process worker, so every tab — initiating,
 * refreshed, or second — replays persisted chunks and tails the RunBus through
 * the same cursor-based stream. Each SSE event carries a batch of JSONL lines
 * folded incrementally into the render view model: O(1) work per chunk, never
 * a whole-body re-reduce. See docs/specs/05 & 11.
 */
export function useRunStream(runId: string | undefined): RunStream {
  const reducerRef = useRef<StreamReducer | null>(null);
  const [reduced, setReduced] = useState<ReducedMessage>(EMPTY);
  const [errored, setErrored] = useState(false);

  // Reset reducer state synchronously when the run changes (render-time
  // derived-state adjustment, so no stale parts flash between runs).
  const [prevRunId, setPrevRunId] = useState(runId);
  if (prevRunId !== runId) {
    setPrevRunId(runId);
    reducerRef.current = null;
    setReduced(EMPTY);
    setErrored(false);
  }

  trpc.runs.stream.useSubscription(
    { runId: runId ?? "", lastEventId: null },
    {
      enabled: Boolean(runId),
      onData: (event) => {
        const reducer = (reducerRef.current ??= createStreamReducer());
        for (const line of event.data) {
          try {
            reducer.fold(JSON.parse(line) as UIMessageChunk);
          } catch {
            // Skip a corrupt line; rendering the rest beats dropping the run.
          }
        }
        setReduced(reducer.snapshot());
      },
      onError: () => setErrored(true),
    },
  );

  return {
    reduced,
    streamStatus: errored ? "error" : reduced.finished ? "done" : "streaming",
  };
}
