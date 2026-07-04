import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** V1 runs as a single anonymous user; keep userId now so Clerk can land in V2
 * without a data migration. See docs/specs/01 → Auth Posture. */
export const runStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const artifactType = v.union(
  v.literal("sql"),
  v.literal("table"),
  v.literal("chartSpec"),
  v.literal("finding"),
  v.literal("error"),
);

export default defineSchema({
  threads: defineTable({
    userId: v.string(),
    title: v.string(),
    pinned: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_user_pinned_updated", ["userId", "pinned", "updatedAt"]),

  messages: defineTable({
    threadId: v.id("threads"),
    userId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    /** Plain text: the user's message, or the assistant's final answer text. */
    text: v.string(),
    /** Assistant full-fidelity render parts (reasoning, tool rows, text). */
    parts: v.optional(v.array(v.any())),
    /** One-line tool summaries used for history compaction (assistant turns). */
    toolLines: v.optional(v.array(v.string())),
    runId: v.optional(v.id("runs")),
    status: v.optional(
      v.union(v.literal("complete"), v.literal("failed"), v.literal("cancelled")),
    ),
    /** Assistant turn wall-clock duration, for the "Worked for Ns" label. */
    durationMs: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_thread", ["threadId", "createdAt"]),

  runs: defineTable({
    threadId: v.id("threads"),
    userId: v.string(),
    /** persistent-text-streaming stream carrying live JSONL output. */
    streamId: v.string(),
    status: runStatus,
    stopRequested: v.optional(v.boolean()),
    heartbeatAt: v.optional(v.number()),
    modelAlias: v.string(),
    modelId: v.optional(v.string()),
    skillsVersion: v.string(),
    activeSkillNames: v.array(v.string()),
    loadedSkillNames: v.array(v.string()),
    userMessageId: v.optional(v.id("messages")),
    assistantMessageId: v.optional(v.id("messages")),
    /** For retry runs: only history at/before this time is fed to the model,
     * so the run regenerates the answer to that user turn. */
    retryAnchorAt: v.optional(v.number()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    finishReason: v.optional(v.string()),
    // Metrics (docs/specs/06 → Metrics To Capture).
    stepCount: v.optional(v.number()),
    toolCallCount: v.optional(v.number()),
    sqlCount: v.optional(v.number()),
    usage: v.optional(v.any()),
  })
    .index("by_thread", ["threadId", "startedAt"])
    .index("by_status_heartbeat", ["status", "heartbeatAt"])
    .index("by_stream", ["streamId"]),

  runEvents: defineTable({
    runId: v.id("runs"),
    threadId: v.id("threads"),
    type: v.string(),
    createdAt: v.number(),
    metadata: v.any(),
  }).index("by_run", ["runId", "createdAt"]),

  artifacts: defineTable({
    runId: v.id("runs"),
    threadId: v.id("threads"),
    messageId: v.optional(v.id("messages")),
    type: artifactType,
    title: v.string(),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_run", ["runId", "createdAt"])
    .index("by_thread", ["threadId", "createdAt"]),
});
