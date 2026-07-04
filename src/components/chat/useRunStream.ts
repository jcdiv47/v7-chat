"use client";

import { useMemo } from "react";
import { useStream } from "@convex-dev/persistent-text-streaming/react";
import type { StreamId } from "@convex-dev/persistent-text-streaming";
import { api } from "@/lib/convexApi";
import {
  parseStreamBody,
  reduceChunks,
  type ReducedMessage,
} from "@/lib/agent/stream-parts";

function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (explicit) return explicit;
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  return cloud.replace(".convex.cloud", ".convex.site");
}

export type RunStream = {
  reduced: ReducedMessage;
  /** persistent-text-streaming status: pending | streaming | done | error | timeout. */
  streamStatus: "pending" | "streaming" | "done" | "error" | "timeout";
};

/**
 * Subscribe to a run's persisted stream. Runs are driven server-side by a
 * scheduled action (see convex/agent/drive.ts), so every tab — initiating,
 * refreshed, or second — reads the persisted body reactively (never `driven`).
 * JSONL is decoded and folded into render parts identically everywhere.
 * See docs/specs/05 → AI SDK UI Integration.
 */
export function useRunStream(streamId: string | undefined): RunStream {
  // `useStream` requires a stream URL for its driven mode; we never drive.
  const streamUrl = useMemo(() => new URL(`${siteUrl()}/chat`), []);
  const body = useStream(
    api.stream.getBody,
    streamUrl,
    false,
    streamId as StreamId | undefined,
  );
  const reduced = useMemo(
    () => reduceChunks(parseStreamBody(body.text)),
    [body.text],
  );
  return { reduced, streamStatus: body.status };
}
