/**
 * Shared, runtime-agnostic types for the analysis agent. Imported by the
 * server worker (Node), the TUI, and the frontend renderer. Keep this file
 * free of Node/browser-only APIs.
 */

export type ModelAlias = "fast" | "analyst" | "sql" | "summarizer";

/** Reasoning effort levels accepted by the AI SDK's top-level `reasoning`
 * call option (mapped to `reasoning_effort` by the OpenAI-compatible provider). */
export type ReasoningEffort =
  | "provider-default"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type ArtifactType = "sql" | "table" | "chartSpec" | "view" | "finding" | "error";

/** A column descriptor returned from a SQL query. */
export type SqlColumn = { name: string; type?: string };

/** Successful `runSql` result (full fidelity, as returned by the executor). */
export type RunSqlOutput = {
  ok: true;
  columns: SqlColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  executionTimeMs: number;
  sql: string;
  /** Id of the saved result the model can reference in `presentData` — the
   * auto-saved `table` artifact id (web) or a runtime-local id like "r1"
   * (TUI, evals). Added by the deps wrapper, not the executor. */
  resultId?: string;
};

/** Failed `runSql` result. */
export type RunSqlError = {
  ok: false;
  error: string;
  sql: string;
  executionTimeMs?: number;
};

export type RunSqlResult = RunSqlOutput | RunSqlError;

export type TableInfo = { name: string; rowEstimate?: number };

export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
};

export type DescribeTableOutput = {
  table: string;
  columns: ColumnInfo[];
  rowEstimate?: number;
};

export type LoadSkillOutput = {
  skillDirectory: string;
  content: string;
};

/** LEGACY: the pre-`presentData` chart spec, kept only so existing
 * `chartSpec` artifacts still render through the panel's old path. New views
 * use `ViewSpec` from ./ui-spec. */
export type ChartSpec = {
  type: "bar" | "horizontalBar" | "line" | "table" | "none";
  title: string;
  x?: string;
  y?: string;
  sourceSql?: string;
};

/**
 * Runtime context threaded through the agent for logging/telemetry.
 * Mirrors the shape in docs/specs/02-agent-runtime.md.
 */
export type AnalysisRuntimeContext = {
  requestId: string;
  runId: string;
  threadId: string;
  userId: string;
  orgId?: string;
  modelAlias: ModelAlias;
  activeSkillNames: string[];
  loadedSkillNames: string[];
  skillsVersion: string;
};

/**
 * Dependency surface the agent tools execute against. The web runtime and the
 * TUI provide different implementations (Drizzle-backed server deps vs. direct
 * Postgres + console), but the tool definitions are identical.
 */
export type AgentToolDeps = {
  listTables(): Promise<TableInfo[]>;
  describeTable(name: string): Promise<DescribeTableOutput>;
  runSql(input: { sql: string; purpose?: string }): Promise<RunSqlResult>;
  loadSkill(name: string): Promise<LoadSkillOutput>;
  saveArtifact(input: {
    type: ArtifactType;
    title: string;
    payload: Record<string, unknown>;
  }): Promise<{ id: string }>;
  /** Metadata for a saved query result, by `resultId`. Thread-scoped in the
   * web runtime (cross-turn references are valid); an in-memory map in the
   * TUI and eval harness. Null for an unknown id. */
  getResultMeta(
    resultId: string,
  ): Promise<{ columns: string[]; rowCount: number } | null>;
};

/** Lifecycle events captured for observability (V1 substitute for Langfuse). */
export type RunEventType =
  | "run.started"
  | "step.started"
  | "step.finished"
  | "tool.started"
  | "tool.finished"
  | "sql.executed"
  | "artifact.saved"
  | "run.completed"
  | "run.failed";

export type RunEvent = {
  type: RunEventType;
  createdAt: number;
  metadata: Record<string, unknown>;
};
