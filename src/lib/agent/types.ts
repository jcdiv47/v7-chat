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

/** One clarification question inside an `askUser` call. */
export type AskUserQuestion = {
  question: string;
  kind: "single" | "multi";
  options: { label: string; description?: string }[];
};

/** Input for the `askUser` clarification-question tool: the agent batches
 * every clarification it needs into one call (1–3 questions). */
export type AskUserInput = {
  questions: AskUserQuestion[];
};

/** The user's answer to one question. */
export type QuestionAnswer = {
  /** Labels of the chosen options (single-choice: length ≤ 1). Empty when the
   * user answered purely via free text. */
  selected: string[];
  /** Free-text "Other" reply, standalone or alongside selections. */
  otherText?: string;
};

/** The recorded answer to an `askUser` call — written into the tool part's
 * `output` by the answer mutation (web) or returned by the readline prompt
 * (TUI). `answers` aligns by index with the input's `questions`. */
export type AskUserAnswer = {
  answered: true;
  answers: QuestionAnswer[];
};

/** Normalize an `askUser` part input to the questions array, accepting the
 * legacy single-question flat shape ({ question, kind, options }) persisted
 * in message parts before questions were batched. */
export function normalizeAskUserQuestions(input: unknown): AskUserQuestion[] {
  if (!input || typeof input !== "object") return [];
  const obj = input as { questions?: unknown; question?: unknown };
  if (Array.isArray(obj.questions)) return obj.questions as AskUserQuestion[];
  if (typeof obj.question === "string") {
    const legacy = input as {
      question: string;
      kind?: "single" | "multi";
      options?: AskUserQuestion["options"];
    };
    return [
      {
        question: legacy.question,
        kind: legacy.kind ?? "single",
        options: legacy.options ?? [],
      },
    ];
  }
  return [];
}

/** Normalize an `askUser` part output to per-question answers, accepting the
 * legacy flat shape ({ answered, selected, otherText }). Undefined while the
 * question is unanswered. */
export function normalizeAskUserAnswers(
  output: unknown,
): QuestionAnswer[] | undefined {
  if (!output || typeof output !== "object") return undefined;
  const obj = output as {
    answered?: boolean;
    answers?: QuestionAnswer[];
    selected?: string[];
    otherText?: string;
  };
  if (!obj.answered) return undefined;
  if (Array.isArray(obj.answers)) return obj.answers;
  return [{ selected: obj.selected ?? [], otherText: obj.otherText }];
}

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
  /** Prompt the human and resolve with their answer. Provided by the TUI
   * (inline readline). The web runtime omits it, so the tool has no
   * `execute`: the loop stops at the question and the answer arrives as the
   * next turn (the AI SDK's HITL stop-and-wait pattern). */
  askUser?(input: AskUserInput): Promise<AskUserAnswer>;
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
