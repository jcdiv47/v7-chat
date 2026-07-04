# 02 Agent Runtime

## Runtime Choice

Use AI SDK V7 `ToolLoopAgent` for V1 interactive analysis. It provides a reusable agent definition with model settings, instructions, tools, loop control, UI streaming, and lifecycle callbacks.

Use `WorkflowAgent` only when V1 needs durable, resumable, or approval-based work. Otherwise keep V1 simple.

The interactive web loop runs inside a Convex HTTP action, detached from the client connection: a browser refresh or disconnect must not abort the run. Only an explicit stop cancels it. See `01-system-architecture.md` → Resumable Streaming.

## Execution Environment

The HTTP action uses Convex's V8 runtime:

- OpenRouter calls are fetch-based and run in the HTTP action directly.
- Node-only work — the Postgres client in particular — lives in `"use node"` internal actions that tools invoke via `ctx.runAction`.
- The TUI runs the same agent definition in a plain Node process with direct tool implementations; only the tool wiring differs between the two entrypoints.

## Model Provider Strategy

OpenRouter is the first-class provider. The application should not hardcode provider model IDs across the codebase. Use a model registry.

Example shape:

```ts
export const modelAliases = {
  fast: "openrouter/<fast-model-id>",
  analyst: "openrouter/<analyst-model-id>",
  sql: "openrouter/<sql-capable-model-id>",
  summarizer: "openrouter/<summary-model-id>",
} as const;
```

The exact OpenRouter model IDs should be chosen and benchmarked during implementation.

## Model Registry Requirements

The model registry should support:

- stable aliases used by agents
- environment-specific overrides
- default temperature and max token settings
- model display names for logs
- future fallback policy
- cost metadata when available

## Agent Instructions

The base agent instructions should be short and stable. Detailed domain behavior belongs in skills.

Base instruction themes:

- You are a business data analyst.
- Use tools to inspect schema and query data.
- Do not invent data.
- Show SQL when it was used.
- Distinguish facts from assumptions.
- Mention caveats when results depend on table grain or missing columns.
- Prefer concise answers with evidence.

## Tools

### `loadSkill`

Loads a local skill by name and returns its instructions. This is required for provider-neutral skills with OpenRouter. Skills are bundled into the deployment at build time (see `04-agent-skills.md` → Skill Bundling); the web runtime reads from the bundle, the TUI from disk.

### `listTables`

Returns available tables from intermediate Postgres. V1 should usually return only:

- `cities`
- `malls`
- `stores`

### `describeTable`

Returns columns, types, nullable flags, and ideally row count estimates for one table.

### `runSql`

Executes read-only SQL against intermediate Postgres.

Responsibilities:

- use server-side database credentials
- enforce timeout and max rows
- log SQL and metadata
- return rows, columns, row count, and execution time
- reject obvious non-read statements

### `saveArtifact`

Stores final or intermediate analysis artifacts in Convex.

Artifact types:

- `sql`
- `table`
- `chartSpec`
- `finding`
- `error`

### `proposeChart`

Optional V1 tool or local function. Converts result metadata into a chart spec. It can also be model-generated structured output.

## Runtime Context

Pass shared runtime state through AI SDK runtime context.

Recommended context fields:

```ts
type AnalysisRuntimeContext = {
  requestId: string;
  runId: string;
  threadId: string;
  userId: string;
  orgId?: string;
  modelAlias: "fast" | "analyst" | "sql" | "summarizer";
  activeSkillNames: string[];
  skillsVersion: string;
};
```

## Tool Context

Use tool-specific context for secrets and scoped clients.

Example:

```ts
toolsContext: {
  runSql: {
    databaseUrl: process.env.INTERMEDIATE_DATABASE_URL,
    statementTimeoutMs: 10_000,
    maxRows: 500,
  },
  saveArtifact: {
    convexClient,
    runId,
  },
}
```

In the web runtime, `runSql` receives a handle to the `"use node"` internal action instead of a raw database URL; the URL stays in the Convex environment read by that action. The TUI wires the database URL directly.

Do not put credentials in the prompt or runtime context.

## Loop Control

Default V1 loop settings:

- maximum 8-12 steps for interactive chat
- at each step boundary: check for a stop request and stamp the run heartbeat
- stop when final answer is produced
- require tool use for prompts that ask data questions
- allow no-tool responses for app guidance or clarification questions

Potential behavior:

- Step 1: load domain skill or inspect schema.
- Step 2: draft and run SQL.
- Step 3: inspect result and optionally run follow-up SQL.
- Step 4: answer with artifacts.

## Structured Output

Use structured output for final artifact capture when feasible.

Suggested final answer shape:

```ts
type AnalysisAnswer = {
  answer: string;
  evidence: string[];
  caveats: string[];
  sqlUsed: string[];
  chart?: {
    type: "bar" | "line" | "table" | "none";
    title: string;
    x?: string;
    y?: string;
  };
  followUps: string[];
};
```

Do not block V1 on perfect structured output. The artifact tool can store SQL and result previews even if final prose is free-form.

## Stream Persistence

Pipe the agent's UI message stream into `@convex-dev/persistent-text-streaming` while it streams, so live runs survive refresh:

- append each part (reasoning delta, tool-call state transition, text delta) as one JSON-serialized line through the component's chunk appender
- the component batches chunk persistence and streams the same bytes over the HTTP response to the initiating tab
- part ordering is preserved by the single append-only stream, so a replay renders the same interleaving
- keep tool-output parts compact: stream columns, row count, and a small row preview (~20 rows); the full preview lives in the run's artifacts/events, which the UI fetches when a tool row is expanded
- on run completion, store the final assistant message on the thread and delete or compact the stream chunks

## Message Storage And History

Messages are stored in Convex as AI SDK UI messages: role plus ordered parts.

- The stored assistant message keeps full parts fidelity — reasoning, tool calls with inputs and output summaries, text — because stream chunks are deleted after the run and prior sessions must still render folded thinking and expandable tool rows.
- Full tool result previews are not embedded in the message; tool parts reference the artifact / run event that holds them.

Model context for a new turn is built from the thread's messages with a compaction policy:

- current turn: full fidelity
- prior turns: user text, assistant text, and one-line tool summaries (tool name, SQL, row count); drop reasoning and raw tool outputs
- cap history at the last 100 messages or ~20k tokens of compacted history (estimated by characters), whichever binds first; smarter summarization is a V2 concern
- history is re-sent on every step of the tool loop, so long threads lean on prompt caching where the underlying model supports it

## Lifecycle Logging

Capture these events:

- run started
- step started
- model alias used
- tool call started
- tool call finished
- SQL executed
- artifact saved
- run finished
- run failed

This is the V1 substitute for Langfuse.

