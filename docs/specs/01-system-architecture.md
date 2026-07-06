# 01 System Architecture

> **Superseded in part by [11 — Remove Convex](./11-remove-convex.md).** The
> Convex backend described below was replaced by a single long-lived Next.js
> service on Railway with Postgres (Drizzle), tRPC, an in-process run worker,
> and SSE streaming. The agent runtime, tools, skills, and data-access design
> here still apply; read Convex-specific sections as historical context.

## Architecture Overview

The original V1 architecture used Convex as the app backend and state store.
That backend has been replaced by the Postgres/tRPC/SSE design in
`11-remove-convex.md`; the diagram below is retained as historical context for
the pre-migration design. The separate intermediate Postgres analytical data
source and AI SDK V7 agent runtime remain part of the current architecture.

```mermaid
flowchart LR
  U["User"] --> FE["Next.js frontend\nAI SDK UI + Tailwind + shadcn/ui"]
  FE --> MU["Convex mutation\ncreate run + schedule driver"]
  MU --> DA["Scheduled Convex action\nagent loop driver"]
  DA --> AG["AI SDK V7 ToolLoopAgent"]
  AG --> OR["OpenRouter model gateway"]
  AG --> QT["Postgres query tool\n('use node' internal action)"]
  QT --> IPG["Intermediate Postgres\ncities, malls, stores"]
  DA --> CVX["Convex tables\nthreads, runs, events, artifacts,\nstream chunks"]
  FE --> CVX
  RAW["Raw business Postgres"] --> ETL["External materialization pipeline"]
  ETL --> IPG
```

## Component Responsibilities

### Frontend

- Claude-like chat shell: collapsible sidebar (pinned + recent sessions), conversation
  column, global search modal, and on-demand artifact panel.
- Stream reasoning, tool calls, and intermediate text live in a single open work
  block per turn, which collapses into a `Worked for Ns` summary when the final
  response starts streaming.
- Reattach to in-flight runs after a refresh: rebuild the live view from
  persisted stream deltas and keep streaming from the run stream subscription.
- Render chat, tool activity, results, charts, and analysis artifacts.
- Use AI SDK UI for streaming agent messages (text, reasoning, and tool parts).
- Use Tailwind and shadcn/ui for layout and controls.
- Keep SQL visible and copyable.

### Historical Run Driver (Scheduled Convex Action)

The original agent loop ran in an internal Convex action scheduled by the mutation that
creates the run (`ctx.scheduler.runAfter(0, …)`), so execution starts unconditionally
and never depends on any client connection. Next.js only serves the frontend; there is
no chat HTTP endpoint.

- Execute the `ToolLoopAgent` for the run created by the send-message mutation.
- Pass runtime context: user, org, thread, run, model alias, active skill set.
- Append the agent's UI message stream to `@convex-dev/persistent-text-streaming`,
  one JSON line per part (reasoning delta, tool state change, text delta) — clients
  read it through the reactive `getStreamBody` subscription.
- Bridge agent events into run logs.
- Call Postgres tools through `"use node"` internal actions, since the driver runs in
  the V8 runtime.
- Never tie run completion to the client connection; only an explicit stop cancels a
  run.

### Historical Convex Backend

- Store application state, not analytical data.
- Own users, organizations, threads, messages, runs, run events, artifacts, and saved outputs.
- Enforce app-level authorization (a stub in V1's single-user mode; real enforcement
  arrives with Clerk in V2).
- Provide live updates for run state and artifact panels.
- Persist in-flight stream chunks via `@convex-dev/persistent-text-streaming` so live
  runs survive refresh and multiple tabs can watch the same run.

### AI SDK Agent Runtime

- Use `ToolLoopAgent` for interactive analysis.
- Use tools to inspect schema, run SQL, save artifacts, and present data views.
- Use local agent skills to steer domain behavior.
- Use OpenRouter model aliases through a central model registry.

### Intermediate Postgres

- Hold queryable business analysis tables.
- Expose read-only credentials to the agent query tool.
- Apply database-level safety settings such as read-only role and statement timeouts.

### Raw Business Postgres

- Not accessed by the agent.
- Feeds the intermediate database through an external materialization pipeline.

## Runtime Flows

### Interactive Chat Flow

1. User sends a message from the frontend.
2. A tRPC mutation stores the message, creates the run, and starts the in-process
   worker after commit.
3. The worker executes the `ToolLoopAgent`.
4. Agent loads relevant skills if needed.
5. Agent calls schema/query tools; Postgres tools run through server-side
   executor dependencies.
6. Tools execute against intermediate Postgres.
7. Each streamed part (reasoning, tool state, text) is published to the RunBus
   and persisted to `run_chunks` as a JSONL line; every open tab renders it
   through the cursor-based `runs.stream` tRPC SSE subscription.
8. If the user refreshes or reopens the thread mid-run, the client sees the run is
   still active, replays persisted chunks from Postgres, and continues live from
   the subscription.
9. Postgres stores messages, events, SQL, result previews, view artifacts, and
   the final answer; stream chunks can be compacted after the final message is
   stored.

### Local TUI Flow

1. Developer starts the TUI entrypoint.
2. TUI loads the same agent configuration.
3. TUI uses local environment variables for OpenRouter and Postgres.
4. Developer tests prompts, skills, model aliases, and query behavior quickly.

## Resumable Streaming

Streaming must survive a browser refresh. If the agent is mid-run — thinking, calling
tools, or streaming the final answer — reloading the page reattaches to the same live
run and streaming continues.

Design rules:

1. **Postgres-backed chunks are the replay source for live output.** As the
   agent streams, the server persists every UI message stream part (reasoning
   deltas, tool-call state changes, text deltas) to `run_chunks` as an ordered,
   append-only stream tied to the run.
2. **The run does not depend on the client connection.** Execution lives in the
   in-process worker, started after the run-creating mutation commits, so it
   starts and completes regardless of what any browser does — including closing
   immediately after sending. Only an explicit stop cancels a run.
3. **Clients render from the run stream subscription.** A refreshed client loads
   the thread, sees a run with status `running`, replays the persisted stream to
   rebuild the in-progress message, and keeps receiving new parts over tRPC SSE
   until the run finishes.
4. **The subscription is the only live transport.** Every tab — initiating,
   refreshed, or second — renders from the same persisted stream plus RunBus
   tail, so correctness — including stop, errors, and the final answer — is
   defined by what lands in run state and chunks.
5. **Streams are transient.** Once the run completes and the final assistant message is
   stored, the stream chunks can be compacted or deleted.

### Chosen Implementation

The current V1 implementation is the Postgres/tRPC/SSE design in
`11-remove-convex.md`:

- A tRPC mutation creates the run and starts the in-process worker after commit.
- The worker runs the `ToolLoopAgent`, encodes UI message parts as JSONL, and
  writes each line through the chunk writer.
- The chunk writer publishes immediately to the in-memory RunBus and
  batch-flushes to `run_chunks`.
- All tabs read through `runs.stream`, which first replays persisted chunks by
  cursor and then tails the RunBus.
- Stop and liveness are side channels on run state: the loop checks stop at step
  boundaries and stamps `heartbeatAt`; a sweeper fails stale runs.
- One run per thread at a time: the send mutation rejects a new message while
  the thread has a live run; the composer offers stop instead.

### Durable Workflow Flow

V1 can avoid durable workflows unless needed. Use `WorkflowAgent` later for:

- approval waits
- scheduled analysis
- long report generation
- resumable multi-step investigations
- background refreshes

## Required Environment Variables

Names can change during implementation, but the app should centralize access to these values:

```txt
OPENROUTER_API_KEY=
INTERMEDIATE_DATABASE_URL=
DATABASE_URL=
```

`OPENROUTER_API_KEY`, `DATABASE_URL`, and `INTERMEDIATE_DATABASE_URL` live in
the app service environment. The TUI reads the same model and intermediate
database names from the local environment.

Potential V2 values:

```txt
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=
```

## Auth Posture

V1 has no authentication: the app runs as a single anonymous user.

- No login, no user accounts, no org scoping in V1.
- Keep `userId` fields in the schema now (a constant placeholder value in V1) so Clerk
  can land in V2 without a data migration.
- Backend procedures do not authenticate callers in V1; do not expose the
  deployment beyond the intended users.
- V2 adds Clerk: identity on threads/runs/artifacts, per-user pinned sessions, and real
  authorization checks in backend procedures.

## Boundary Rules

- The model never receives database credentials.
- The model never connects directly to Postgres.
- The model only calls typed tools.
- Tools receive credentials through server-side tool context.
- Raw data is not in the agent tool surface.
- The app database stores artifacts and logs, not full analytical warehouse data.

## Failure Handling

| Failure | V1 Behavior |
| --- | --- |
| OpenRouter request fails | Return clear error, save run event, allow retry |
| SQL timeout | Return timeout message, save SQL and timeout metadata |
| SQL error | Return concise DB error, save failed query for debugging |
| Empty result | Explain that the query returned no rows and suggest follow-up |
| Unknown schema | Ask the schema tool first, then continue or fail clearly |
| Client disconnect or refresh | Run continues in the in-process worker; client reattaches and replays the persisted stream |
| Server dies mid-run | Heartbeat goes stale; sweeper (or the next send) finalizes the run as failed with a visible assistant message holding any partial output; retry allowed |

## Architecture Risks

- OpenRouter model behavior varies by underlying model; model aliases and evals are mandatory.
- Skills steer behavior but do not enforce safety.
- A tiny schema reduces V1 risk, but SQL transparency is still important for trust.
- Deferred semantic layer means table/column naming must carry more meaning.
