# 06 Evals Observability

## V1 Observability Goal

Langfuse is deferred to V2, but V1 must capture enough structured run data to
debug behavior and migrate to Langfuse later. App Postgres remains the source
of truth for product state; Langfuse is an observability sink, not a dependency
for run correctness.

Current V1 run logging captures lifecycle events, model/run identifiers,
tool/SQL activity, and aggregate token counts when the provider reports them.
Before enabling Langfuse, the run usage shape must be widened so the app
preserves provider usage details instead of narrowing them to three aggregate
counts.

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

Target usage shape for the Langfuse-readiness work:

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
  /** Raw provider usage payloads, one per model step. A run makes one
   * OpenRouter request per step, so there is no single merged raw payload. */
  raw?: Record<string, unknown>[];
  /** Sum of per-step OpenRouter `raw.cost` values, when present. */
  costUsd?: number;
};
```

Per-step usage (including the step's raw payload) already has a home: the
`step.finished` run event logs `step.usage`. The run-level record keeps the
summed aggregates plus `costUsd` = sum of per-step `raw.cost`. Note the runner
also accumulates usage per step as a fallback for aborted/failed runs (the
aggregate result promises reject in that case); the widening work must extend
that fallback path too, or aborted runs lose token details and cost.

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
- token usage if provided
- Langfuse-readiness target: cache and reasoning-token details
- Langfuse-readiness target: OpenRouter raw usage payload, when provided
- Langfuse-readiness target: OpenRouter raw `usage.cost`, when provided

Cost truth comes from OpenRouter, not a local pricing table. When
OpenRouter returns `usage.raw.cost`, trust that value. The Langfuse-readiness
implementation should persist per-step raw usage in run events for
auditability and sum per-step `raw.cost` into a normalized run-level `costUsd`
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
- map each `runId` to one Langfuse trace: the worker makes one `agent.stream()`
  call per run inside one manual root observation (`analysis-run`), so all AI
  SDK observations nest under a single trace; trace ids stay SDK-generated —
  cross-link via `runId` in trace metadata/tags, not deterministic trace ids.
  The manual root exists because ended AI SDK spans cannot be amended: it is
  the attachment point for final outcome metadata (run status, finish reason,
  error, active/loaded skills, written after the loop resolves) and for gap
  observations
- use the AI SDK 7 Langfuse integration as the primary source of model-call and
  tool-call observations
- propagate trace-level attributes from the worker (`sessionId`, `userId`,
  run/thread ids, model alias, skills version) so every AI SDK observation can
  be filtered and grouped in Langfuse
- let the AI SDK integration map each ToolLoopAgent model step /
  language-model call to a generation observation
- let the AI SDK integration map executed tool calls to tool observations
- add manual Langfuse observations only for gaps the AI SDK integration cannot
  see: the execute-less web `askUser` call is recorded as a tool observation
  under the manual root when its tool-input chunk streams (question only — the
  answer arrives as the next run's user turn). Normal tool executions, incl.
  `runSql`, are covered by the integration's tool observations and get no
  manual duplicate
- attach skill version, active skills, loaded skills, model alias, underlying
  OpenRouter model id, run status, finish reason, and error metadata
- attach eval labels and user feedback when those surfaces exist

Use the AI SDK 7 `telemetry` option together with the Langfuse AI SDK
integration; do not use the deprecated `experimental_telemetry` API for new
code.

### Langfuse Integration Mechanism

Use one primary integration path: AI SDK 7 telemetry exported to Langfuse
through OpenTelemetry.

Implementation requirements:

- install the Langfuse AI SDK 7 and OpenTelemetry packages:
  `@langfuse/client`, `@langfuse/vercel-ai-sdk`, `@langfuse/tracing`,
  `@langfuse/otel`, and `@opentelemetry/sdk-node`
- initialize OpenTelemetry once at process boot with `NodeSDK` and
  `LangfuseSpanProcessor`
- register `new LangfuseVercelAiSdkIntegration()` once with AI SDK
  `registerTelemetry`
- import that instrumentation before any `ToolLoopAgent` run starts
- wrap `runAnalysisAgent` execution in Langfuse `propagateAttributes`, setting
  `traceName`, `sessionId = threadId`, `userId`, tags/environment, and metadata
  such as `runId`, `threadId`, model alias, model id, and skills version
- inside that scope, wrap the agent call in a manual root observation
  (`startActiveObservation("analysis-run", …, { asType: "agent" })`); once the
  loop resolves, attach run status, finish reason, error text, and
  active/loaded skills as `langfuse.trace.metadata.*` attributes on the
  still-open root (the SDK's `updateTrace` was removed in v5; direct OTel
  attributes on a live span are the supported path)
- pass AI SDK `telemetry` options on the ToolLoopAgent call to set
  `functionId` and explicitly include safe runtime context keys
- skip Langfuse initialization entirely when the keys are absent or the app
  runs in demo mode (`MODEL_PROVIDER=mock`)
- flush the `LangfuseSpanProcessor` on graceful shutdown (SIGTERM/SIGINT):
  spans are batched and exported asynchronously, so a deploy without a final
  `forceFlush` drops the tail of every run in flight

Do not build a parallel manual trace tree for model calls and normal tool
executions. Manual Langfuse observations are reserved for metadata enrichment
and integration gaps.

### Langfuse Cost Policy

Cost should be based on OpenRouter's own usage accounting:

1. Request usage accounting on every OpenRouter call: OpenRouter only includes
   `cost` in usage when the request body carries `usage: { include: true }`.
   The openai-compatible provider spreads `providerOptions.openrouter` into the
   request body, so pass it there. Without this opt-in, `usage.raw.cost` is
   always absent and the rest of this policy never fires.
2. Trust OpenRouter `usage.raw.cost` when present.
3. Persist each step's raw usage payload unchanged (in `step.finished` run
   events) so we can audit exactly what OpenRouter returned; sum per-step
   `raw.cost` into the run-level `costUsd`.
4. Verify whether the Langfuse AI SDK integration receives
   `costDetails.total` automatically.
5. If not, manually pass `costDetails.total = usage.raw.cost`.

Before relying on this in production, verify a real streamed OpenRouter call in
the selected AI SDK provider path and confirm exactly where the final SSE usage
payload lands (`step.usage.raw`, provider metadata, or raw chunks). The
implementation should persist the raw provider usage object from that location
without re-pricing it locally.

Do not configure Langfuse custom model definitions as the first fallback for
OpenRouter cost. Custom model definitions can be revisited only if we later
decide estimated cost is useful when OpenRouter does not return raw cost.

### SQL Trace Policy

Trace SQL activity, not full result data. A dedicated SQL observation (and the
`sql.executed` run event) should include:

- SQL statement
- purpose, when supplied
- success/failure
- execution time
- concise error text, when failed

Do not send table artifact payloads or the full 100-500 row artifact preview
to Langfuse. Result inspection belongs in App Postgres artifacts and the
application UI, not the tracing backend.

One deliberate exception: the AI SDK integration records model-call inputs,
outputs, and tool results, and the model's context contains the tool-result
preview (up to `maxRows` rows). That model-visible preview is accepted inside
generation/tool observations — it is exactly the context needed to debug model
behavior, and stripping it would gut the tracing. The policy above governs
what we *add* to Langfuse, not what the model already saw. If stricter
redaction is ever required, use the `LangfuseSpanProcessor` masking hook or
the AI SDK telemetry input/output recording controls, not a parallel manual
trace tree.

`run_chunks` also have no Langfuse mapping. They are transient SSE replay
plumbing; finalized assistant messages and Langfuse traces are the durable
conversation/observability records.
