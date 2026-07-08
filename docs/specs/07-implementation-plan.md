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
- separate `search_terms` table for app-managed title search
- run liveness: heartbeat and stop-request fields, scheduled stale-run sweeper
- artifacts

Acceptance criteria:

- A run can be created and completed.
- Events can be appended in order.
- A partial assistant message can be reconstructed, in order, from a persisted stream body.
- A `running` run with a stale heartbeat is marked failed by the sweeper.
- Artifacts can be attached to a run.
- Thread titles can be tokenized into English terms and Chinese bigrams without
  adding derived search columns to `threads`.

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
- global title search modal (Cmd/Ctrl+K)
- chat streaming through tRPC mutation + `runs.stream` SSE subscription
- resumable streaming: cursor-based JSONL replay from `run_chunks`, then live
  tailing from RunBus
- thinking + tool-call rendering with live → folded lifecycle
- artifact panel with SQL, table, and chart tabs, opened for the latest run
- stop and retry controls
- example prompts / empty state

Acceptance criteria:

- User can ask a question in the browser.
- User can see streamed thinking and tool calls fold into a summary, then a streamed answer.
- Refreshing mid-run reattaches to the live stream; the run continues and completes with no duplicated or lost content.
- User can stop a run mid-stream and retry a message; retry appends a new run.
- User can browse pinned/recent sessions and open a session via the title search modal.
- User can inspect SQL and result preview for the latest run.
- Basic chart appears for grouped results.

## Phase 6A: Historical Artifact Access

Goal: make artifacts for every visible assistant response inspectable without changing
the artifact storage model or adding a schema migration. The panel remains run-scoped;
the chat shell owns which run is selected.

Backend deliverables:

- Add `artifacts.summaryForThread({ threadId })`.
- Scope the query by the owned thread and `ctx.userId`.
- Return one summary per run (keyed by `runId` on the client), each carrying:
  - `runId`
  - `messageId | null` (the run's associated assistant message)
  - total artifact count
  - counts by artifact type (`sql`, `table`, `view`, `finding`, `error`, `chartSpec`)
  - latest artifact creation time
- Keep full artifact payloads out of the summary response. `artifacts.listForRun`
  remains the only query used by the panel for selected-run payloads.
- Invalidate the summary query when a run finishes, and poll/refetch it while the
  currently selected live run is producing artifacts.

Frontend deliverables:

- Replace the single nullable `artifactRunId` shell state with a selected artifact
  target:
  - `null` for closed
  - `latest` for the thread's latest run
  - explicit `runId` for a historical assistant response
- Resolve `latest` to `runs.latestForThread.id` at render time so the default panel
  tracks the newest run.
- Pass `onOpenArtifacts(runId)` and the active selected run into `Conversation`.
- Fetch `artifacts.summaryForThread` once per thread and build a `runId` keyed map for
  message action badges/visibility.
- Add a compact artifact/analysis icon button to each assistant response action row
  when the message has a `runId`. Use the summary count for the badge or visibility,
  but allow failed/cancelled runs to open if the product labels the action as
  `Analysis`.
- Preserve the existing global/sidebar `Artifacts` behavior as "open latest run"; if
  a historical run is open, invoking the global action switches back to latest.
- Keep mobile behavior unchanged: the selected run opens in the same sheet-style
  artifact panel.

Acceptance criteria:

- Opening `Artifacts` from the sidebar/top bar shows the latest run for the current
  thread.
- Opening the artifact button on an older assistant response shows that response's SQL,
  tables, charts/views, errors/findings, answer, and run metadata.
- Switching between response buttons updates the existing panel instead of opening
  multiple panels.
- The active response's artifact control has a visible selected state.
- No full artifact payloads are fetched for every message in the conversation.
- A running latest run can be opened and continues to refresh artifacts/events as they
  are saved.
- Failed or cancelled assistant turns with saved artifacts remain inspectable.
- Edit-and-rerun pruned turns do not appear as historical artifact targets in the
  current conversation.

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
- Message-body search over user and assistant turns.
- Fuzzy search for typo tolerance and partial matches.
- PGroonga-backed multilingual search if standard Postgres plus app-side
  tokenization is not enough.
