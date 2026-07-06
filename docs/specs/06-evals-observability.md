# 06 Evals Observability

## V1 Observability Goal

Langfuse is deferred to V2, but V1 must capture enough structured run data to
debug behavior and migrate to Langfuse later. App Postgres remains the source
of truth for product state; Langfuse is an observability sink, not a dependency
for run correctness.

## Run Records

Suggested entities:

```ts
type AgentRun = {
  id: string;
  threadId: string;
  userId: string; // Clerk user id
  orgId?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  stopRequested?: boolean; // set by the stop mutation; loop checks at step boundaries
  heartbeatAt?: number; // stamped each step; stale while running => dead run
  modelAlias: string;
  modelId?: string;
  skillsVersion: string;
  activeSkillNames: string[];
  loadedSkillNames: string[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
  usage?: AgentRunUsage;
};
```

`usage` should preserve both normalized fields and the provider payload:

```ts
type AgentRunUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
  /** Raw provider usage payload, especially OpenRouter's reported cost. */
  raw?: Record<string, unknown>;
  /** Prefer OpenRouter `raw.cost` when present. */
  costUsd?: number;
};
```

```ts
type AgentRunEvent = {
  id: string;
  runId: string;
  type:
    | "run.started"
    | "step.started"
    | "tool.started"
    | "tool.finished"
    | "sql.executed"
    | "artifact.saved"
    | "run.completed"
    | "run.failed";
  createdAt: number;
  metadata: Record<string, unknown>;
};
```

Live stream persistence is owned by `run_chunks`: the stream body is
JSONL-encoded AI SDK UI message parts, keyed by run and sequence cursor (see
`01-system-architecture.md` -> Resumable Streaming). Chunks are transient
implementation detail for refresh/replay, so they need no Langfuse mapping.

```ts
type AgentArtifact = {
  id: string;
  runId: string;
  type: "sql" | "table" | "view" | "chartSpec" | "finding" | "error";
  title: string;
  payload: Record<string, unknown>;
  createdAt: number;
};
```

## Metrics To Capture

- model alias
- underlying OpenRouter model ID
- prompt/request ID if available
- step count
- tool call count
- SQL count
- SQL execution time
- row count
- truncation flag
- error type
- total duration
- token usage if provided, including cache and reasoning-token details
- OpenRouter raw usage payload, when provided
- OpenRouter raw `usage.cost`, when provided

Cost truth comes from OpenRouter, not a local pricing table. When
OpenRouter returns `usage.raw.cost`, trust that value and persist it in
`runs.usage.raw` for auditability. Also copy it into a normalized `costUsd`
field for querying. Do not add Langfuse custom model definitions as a fallback
while OpenRouter raw cost is absent; pricing can vary by OpenRouter provider
route, so inferred local pricing is not worth maintaining for V1/V2.

## Evals

Before polishing the UI, create a small eval set with 15-30 prompts.

### Required Eval Categories

Counting:

- How many cities are represented?
- How many malls are in each city?
- How many stores are in each mall?

Ranking:

- Which city has the most malls?
- Which mall has the most stores?
- Show the top 10 malls by store count.

Join correctness:

- List malls with their city.
- List stores with mall and city.

Missing data:

- Are there malls with no stores?
- Are there cities with no malls?

Ambiguity:

- Which locations are strongest?
- What is the best mall?

Unavailable data:

- Which mall has the highest revenue?
- Which city had the fastest growth last quarter?

Chart behavior:

- Chart stores by city.
- Show a bar chart of malls by city.

## Eval Scoring

Use a simple manual or scripted rubric:

| Criterion | Pass Requirement |
| --- | --- |
| Correct SQL | Query uses valid tables and joins |
| Grounded answer | Answer follows from query result |
| Caveats | Mentions missing data or ambiguity |
| Skill usage | Loads relevant skill when useful |
| UI artifact | Produces SQL and result artifact |
| Failure behavior | Fails clearly without hallucination |

## V2 Langfuse Path

When adding Langfuse, keep the app database as the durable run record and send
Langfuse an async observability view:

- map `threadId` to Langfuse `sessionId`, so a chat session groups all of its
  agent runs into one replayable observability timeline
- map each `runId` to one Langfuse trace, preferably with a deterministic trace
  id derived from `runId` for easy cross-linking
- wrap the worker run in a root `agent` observation
- map each ToolLoopAgent model step / language-model call to a generation
  observation
- map tool calls to tool observations
- attach skill version, active skills, loaded skills, model alias, underlying
  OpenRouter model id, run status, finish reason, and error metadata
- attach eval labels and user feedback when those surfaces exist

Use the AI SDK 7 `telemetry` option together with the Langfuse AI SDK
integration; do not use the deprecated `experimental_telemetry` API for new
code.

### Langfuse Cost Policy

Cost should be based on OpenRouter's own usage accounting:

1. Trust OpenRouter `usage.raw.cost` when present.
2. Persist `usage.raw` unchanged in `runs.usage` so we can audit exactly what
   OpenRouter returned.
3. Verify whether the Langfuse AI SDK integration receives
   `costDetails.total` automatically.
4. If not, manually pass `costDetails.total = usage.raw.cost`.

Do not configure Langfuse custom model definitions as the first fallback for
OpenRouter cost. Custom model definitions can be revisited only if we later
decide estimated cost is useful when OpenRouter does not return raw cost.

### SQL Trace Policy

Trace SQL activity, not result data. A SQL observation should include:

- SQL statement
- purpose, when supplied
- success/failure
- execution time
- concise error text, when failed

Do not send SQL result rows, row previews, table artifact payloads, or full
result sets to Langfuse. Result inspection belongs in App Postgres artifacts and
the application UI, not the tracing backend.

`run_chunks` also have no Langfuse mapping. They are transient SSE replay
plumbing; finalized assistant messages and Langfuse traces are the durable
conversation/observability records.
