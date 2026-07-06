# 07 Implementation Plan

## Phase 0: Project Setup

Deliverables:

- Next.js app
- Tailwind setup
- shadcn/ui setup
- Postgres/Drizzle app database setup
- AI SDK V7 installed
- OpenRouter provider installed
- Postgres client installed
- environment variable validation

Acceptance criteria:

- App starts locally.
- Dev app database works.
- A test OpenRouter call succeeds.
- A test Postgres connection succeeds.

## Phase 1: Model Gateway

Deliverables:

- `modelRegistry` module
- aliases for `fast`, `analyst`, `sql`, `summarizer`
- OpenRouter-only implementation
- model alias logged on each run

Acceptance criteria:

- Agent code depends on aliases, not raw model IDs.
- Changing a model ID requires one local config edit.

## Phase 2: Run Schema

Deliverables:

- threads
- messages
- agent runs
- run events
- `run_chunks` wired in for persisted JSONL stream replay
- run liveness: heartbeat and stop-request fields, scheduled stale-run sweeper
- artifacts

Acceptance criteria:

- A run can be created and completed.
- Events can be appended in order.
- A partial assistant message can be reconstructed, in order, from a persisted stream body.
- A `running` run with a stale heartbeat is marked failed by the sweeper.
- Artifacts can be attached to a run.

## Phase 3: Postgres Query Tools

Deliverables:

- `listTables`
- `describeTable`
- `runSql`
- Postgres access through server-side executor dependencies (web) and a direct
  client (TUI)
- basic SQL read-only guard
- timeout and max row handling
- SQL artifact saving

Acceptance criteria:

- Tool can list `cities`, `malls`, `stores`.
- Tool can describe table columns.
- Tool can execute a simple `select`.
- Tool rejects obvious write statements.
- Tool logs successful and failed queries.

## Phase 4: Agent Skills

Deliverables:

- local skill discovery
- build-time skill bundling (codegen inlines skill files into a deployed registry)
- `loadSkill` tool
- initial skills:
  - `mall-domain-analysis`
  - `postgres-analysis`
  - `business-answer-style`
  - `chart-selection`
- skill metadata on runs

Acceptance criteria:

- Agent sees skill names/descriptions.
- Agent can load a skill.
- The web runtime loads skills from the bundle; the TUI loads the same files from disk.
- Loaded skills are recorded on the run.

## Phase 5: ToolLoopAgent

Deliverables:

- business analysis agent
- base instructions
- tools wired with runtime/tool context
- lifecycle logging
- local TUI entrypoint

Acceptance criteria:

- TUI can answer basic mall/store/city questions.
- TUI shows SQL/tool activity.
- Runs produce answer, SQL, and table artifacts.

## Phase 6: Web Chat UI

Deliverables:

- Claude-like chat shell (sidebar + conversation + artifact panel)
- sidebar with pinned and recent session sections
- global search modal (Cmd/Ctrl+K)
- chat streaming through tRPC mutation + `runs.stream` SSE subscription
- resumable streaming: cursor-based JSONL replay from `run_chunks`, then live
  tailing from RunBus
- thinking + tool-call rendering with live → folded lifecycle
- artifact panel with SQL, table, and chart tabs
- stop and retry controls
- example prompts / empty state

Acceptance criteria:

- User can ask a question in the browser.
- User can see streamed thinking and tool calls fold into a summary, then a streamed answer.
- Refreshing mid-run reattaches to the live stream; the run continues and completes with no duplicated or lost content.
- User can stop a run mid-stream and retry a message; retry appends a new run.
- User can browse pinned/recent sessions and open a session via the search modal.
- User can inspect SQL and result preview.
- Basic chart appears for grouped results.

## Phase 7: Evals And Hardening

Deliverables:

- 15-30 eval prompts
- manual expected behavior file
- basic eval runner or checklist
- error-state polish
- timeout and empty-result handling

Acceptance criteria:

- Core evals pass consistently with selected OpenRouter models.
- Failures are logged with enough detail to debug.
- Impossible questions do not hallucinate unavailable data.

## V1 Done Definition

V1 is done when:

- OpenRouter-powered `ToolLoopAgent` runs in both TUI and web UI.
- Agent queries only intermediate Postgres.
- Skills are active, loadable, versioned, and logged.
- Postgres stores threads, messages, runs, events, stream chunks, and artifacts.
- In-flight runs survive browser refresh; clients reattach to live streaming
  through tRPC SSE.
- SQL, table, chart, and final answer are visible in the UI.
- Basic eval suite passes.

## V2 Backlog

- Org scoping and shared workspaces.
- Langfuse tracing.
- WorkflowAgent for durable jobs.
- Semantic layer.
- Strict SQL policy engine.
- Approval flows.
- Scheduled analysis.
- User feedback and eval dashboards.
- Multi-dataset support.
