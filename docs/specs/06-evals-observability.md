# 06 Evals Observability

## V1 Observability Goal

Langfuse is deferred to V2, but V1 must capture enough structured run data to debug behavior and migrate to Langfuse later.

## Convex Run Records

Suggested entities:

```ts
type AgentRun = {
  id: string;
  threadId: string;
  streamId: string; // persistent-text-streaming stream carrying live output
  userId: string; // constant placeholder until Clerk lands in V2
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

Live stream persistence is owned by `@convex-dev/persistent-text-streaming`: each run
stores its `streamId`, and the stream body is JSONL-encoded UI message parts (see
`01-system-architecture.md` → Resumable Streaming). Streams are transient: once the run
completes and the final message is stored, chunks are deleted or compacted, so they need
no Langfuse mapping.

```ts
type AgentArtifact = {
  id: string;
  runId: string;
  type: "sql" | "table" | "chartSpec" | "finding" | "error";
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
- estimated cost if available

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

When adding Langfuse:

- map `AgentRun` to trace
- map agent steps to spans
- map tool calls to spans
- attach SQL metadata
- attach skill version and active skills
- attach model alias and underlying model
- attach eval labels and user feedback

V1 logs should preserve enough fields to backfill or compare with V2 traces.

