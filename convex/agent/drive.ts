/**
 * Server-side driver for chat runs. Scheduled by the mutations that create a
 * run (`chat.sendMessage` / `editAndRerun` / `retryLast`), so execution starts
 * unconditionally — a browser that navigates away or closes right after
 * sending can no longer orphan a run. Clients only ever observe the run
 * through the reactive stream subscription.
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { runAgentDetached } from "./loop";

export const drive = internalAction({
  args: { streamId: v.string() },
  handler: async (ctx, { streamId }) => {
    await runAgentDetached(ctx, streamId);
  },
});
