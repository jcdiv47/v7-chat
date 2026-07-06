/**
 * App database schema (Drizzle over Railway/local Postgres). Core app tables
 * hold threads, messages, runs, events, artifacts, and persisted stream
 * chunks. IDs are UUIDv7 (time-ordered), generated app-side. user_id is text
 * because Clerk user IDs are strings, and BetterAuth would fit the same shape
 * if adopted later. See
 * docs/specs/01-system-architecture.md.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull();

export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    index("threads_user_updated_idx").on(t.userId, t.updatedAt),
    index("threads_user_pinned_updated_idx").on(t.userId, t.pinned, t.updatedAt),
  ],
);

export const searchTerms = pgTable(
  "search_terms",
  {
    userId: text("user_id").notNull(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind", { enum: ["thread_title", "message"] }).notNull(),
    sourceId: uuid("source_id").notNull(),
    term: text("term").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      columns: [t.userId, t.sourceKind, t.sourceId, t.term],
    }),
    index("search_terms_user_term_idx").on(t.userId, t.term),
    index("search_terms_source_idx").on(t.sourceKind, t.sourceId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    /** Plain text: the user's message, or the assistant's final answer text. */
    text: text("text").notNull(),
    /** Assistant full-fidelity render parts (reasoning, tool rows, text). */
    parts: jsonb("parts").$type<unknown[]>(),
    /** One-line tool summaries used for history compaction (assistant turns). */
    toolLines: jsonb("tool_lines").$type<string[]>(),
    /** Not a FK: runs also reference messages, and the cascade flows thread →
     * runs/messages; a circular FK would only complicate deletes. */
    runId: uuid("run_id"),
    status: text("status", { enum: ["complete", "failed", "cancelled"] }),
    /** Assistant turn wall-clock duration, for the "Worked for Ns" label. */
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_thread_created_idx").on(t.threadId, t.createdAt)],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed", "cancelled"],
    }).notNull(),
    stopRequested: boolean("stop_requested").notNull().default(false),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" }),
    modelAlias: text("model_alias").notNull(),
    modelId: text("model_id"),
    skillsVersion: text("skills_version").notNull(),
    activeSkillNames: jsonb("active_skill_names").$type<string[]>().notNull(),
    loadedSkillNames: jsonb("loaded_skill_names").$type<string[]>().notNull(),
    userMessageId: uuid("user_message_id"),
    assistantMessageId: uuid("assistant_message_id"),
    /** For retry runs: only history at/before this time is fed to the model,
     * so the run regenerates the answer to that user turn. */
    retryAnchorAt: timestamp("retry_anchor_at", { withTimezone: true, mode: "date" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    error: text("error"),
    finishReason: text("finish_reason"),
    // Metrics (docs/specs/06 → Metrics To Capture).
    stepCount: integer("step_count"),
    toolCallCount: integer("tool_call_count"),
    sqlCount: integer("sql_count"),
    usage: jsonb("usage"),
  },
  (t) => [
    index("runs_thread_started_idx").on(t.threadId, t.startedAt),
    index("runs_status_heartbeat_idx").on(t.status, t.heartbeatAt),
    // Backstop for the transactional claim in send/edit/retry: even a race
    // that slips past SELECT ... FOR UPDATE cannot create two live runs.
    uniqueIndex("one_live_run_per_thread")
      .on(t.threadId)
      .where(sql`${t.status} = 'running'`),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull(),
    type: text("type").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("run_events_run_created_idx").on(t.runId, t.createdAt)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull(),
    messageId: uuid("message_id"),
    /** `chartSpec` is legacy (pre-presentData rows); new views use `view`.
     * The enum is type-level only (no DB check constraint), so adding a
     * member needs no migration. */
    type: text("type", {
      enum: ["sql", "table", "chartSpec", "view", "finding", "error"],
    }).notNull(),
    title: text("title").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("artifacts_run_created_idx").on(t.runId, t.createdAt),
    index("artifacts_thread_created_idx").on(t.threadId, t.createdAt),
  ],
);

/** The persisted live stream: one row per JSONL line, seq increments per line,
 * inserted in batches by the chunk writer. The run IS the stream — clients
 * subscribe by run id and resume from a seq cursor (the SSE event id). */
export const runChunks = pgTable(
  "run_chunks",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** One JSONL-encoded UIMessageChunk line (no trailing newline). */
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);

export type ThreadRow = typeof threads.$inferSelect;
export type SearchTermRow = typeof searchTerms.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
