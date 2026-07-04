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
 * Subscribe to a run's persisted stream. The initiating tab drives it
 * (`driven: true`, POSTs to the chat HTTP action); refreshed / second tabs read
 * the persisted body reactively. Either way, JSONL is decoded and folded into
 * render parts identically. See docs/specs/05 → AI SDK UI Integration.
 */
export function useRunStream(
  streamId: string | undefined,
  driven: boolean,
): RunStream {
  const streamUrl = useMemo(() => new URL(`${siteUrl()}/chat`), []);
  const body = useStream(
    api.stream.getBody,
    streamUrl,
    driven,
    streamId as StreamId | undefined,
  );
  const reduced = useMemo(
    () => reduceChunks(parseStreamBody(body.text)),
    [body.text],
  );
  return { reduced, streamStatus: body.status };
}
