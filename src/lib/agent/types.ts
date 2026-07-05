/**
 * Shared, runtime-agnostic types for the analysis agent. Imported by the
 * server worker (Node), the TUI, and the frontend renderer. Keep this file
 * free of Node/browser-only APIs.
 */

export type ModelAlias = "fast" | "analyst" | "sql" | "summarizer";

export type ArtifactType = "sql" | "table" | "chartSpec" | "finding" | "error";

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

/** A chart specification produced by the agent / chart-selection skill. */
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
};

/** Lifecycle events captured for observability (V1 substitute for Langfuse). */
export type RunEventType =
  | "run.started"
  | "step.started"
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
