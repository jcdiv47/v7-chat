import { v } from "convex/values";
import { query } from "./_generated/server";
import type { StreamId } from "@convex-dev/persistent-text-streaming";
import { persistentTextStreaming } from "./lib/streaming";

/**
 * Public query returning the persisted stream body (JSONL text + status). The
 * `useStream` hook reads this reactively so refreshed / second tabs rebuild live
 * output. Shape must be `{ streamId } -> StreamBody`.
 *
 * Keyed only by the unguessable streamId (capability-URL security), with no
 * ownership check — every other public query checks the user. Tighten this
 * alongside real auth in V2.
 */
export const getBody = query({
  args: { streamId: v.string() },
  handler: async (ctx, { streamId }) => {
    return await persistentTextStreaming.getStreamBody(ctx, streamId as StreamId);
  },
});
