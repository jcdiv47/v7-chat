# 11 Remove Convex — Postgres + tRPC + SSE Migration

## Motivation

Two problems, one root cause:

- **Cost.** Convex database bandwidth exceeded the 1 GB free tier during
  development. The live-stream read path is O(N²): every appended chunk makes
  the reactive `stream.getBody` subscription re-read and re-send the **entire
  stream body** to every subscriber (acknowledged in
  `convex/agent/loop.ts` — "each one makes the reactive `getBody` subscription
  re-read the [whole body]"). Convex meters exactly this.
- **Streaming feel.** The client (`useRunStream.ts`) re-parses the whole JSONL
  body and re-reduces it on every update, so per-tick work grows linearly with
  run length and the UI updates in body-sized lurches, not deltas.

Removing Convex removes the pattern causing both. The agent core
(`src/lib/agent/`) is already provider-neutral (the TUI proves it) and moves
unchanged. What gets rewritten is the ~1,650 lines under `convex/` and the data
hooks in six frontend files.

## Target Architecture

One long-lived Node service on **Railway** plus two Postgres databases:

```
┌─ Railway private network ─────────────────────────────────┐
│                                                            │
│  app service (single process)                              │
│  ├─ Next.js (UI + tRPC HTTP routes)                        │
│  ├─ run worker (agent loop, in-process)                    │
│  ├─ RunBus (in-memory pub/sub, runId → chunk emitter)      │
│  └─ sweeper (setInterval, stale-run finalizer)             │
│                                                            │
│  app Postgres (Railway) ← threads/messages/runs/chunks     │
└────────────────────────────────────────────────────────────┘
   intermediate Postgres (read-only business data, unchanged)
```

Key decisions:

- **Hosting**: Railway service, `next start` on a custom entry that also boots
  the worker + sweeper. Long-lived — no serverless constraints, no action time
  limits.
- **App DB**: Railway Postgres over the **private network URL**
  (`postgres.railway.internal`). Sub-ms latency, no egress metering, plain `pg`
  `Pool` (size ~10) — no PgBouncer needed with a single long-lived process.
- **ORM**: **Drizzle** (schema-as-code, `drizzle-kit` migrations, types flow
  into tRPC outputs). Drizzle is the query layer, not a host — it runs against
  the Railway Postgres.
- **API**: **tRPC v11** + React Query. Replaces the Convex codegen'd `api.*`
  types with equivalent end-to-end type safety.
- **Live stream transport**: tRPC **SSE subscriptions**
  (`httpSubscriptionLink`) rather than a websocket server. Same tRPC DX,
  no extra server, automatic reconnect with `Last-Event-ID` — which is
  exactly our resume cursor. Everything client→server (send, stop, edit) is a
  plain mutation, so bidirectional WS buys nothing here. If we later want
  cross-tab push invalidation, add a second lightweight SSE topic or upgrade
  to `wsLink` then.
- **No Redis in V1.** One process ⇒ in-memory RunBus suffices. Redis becomes
  necessary only with >1 replica.

## App Database Schema (Drizzle)

Same five tables as `convex/schema.ts`, plus `run_chunks` (the persisted
stream, replacing `@convex-dev/persistent-text-streaming`). IDs are UUIDv7
(time-ordered). `user_id` stays `text` — Clerk and BetterAuth both issue
string IDs, so V2 auth lands without a data migration (BetterAuth would add
its own `user`/`session` tables in this same database).

```ts
threads:    id, user_id, title, pinned, created_at, updated_at
            idx (user_id, updated_at), (user_id, pinned, updated_at)

messages:   id, thread_id → threads, user_id, role ('user'|'assistant'),
            text, parts jsonb, tool_lines jsonb, run_id, status,
            duration_ms, created_at
            idx (thread_id, created_at)

runs:       id, thread_id → threads, user_id,
            status ('running'|'completed'|'failed'|'cancelled'),
            stop_requested bool, heartbeat_at timestamptz,
            model_alias, model_id, skills_version,
            active_skill_names jsonb, loaded_skill_names jsonb,
            user_message_id, assistant_message_id, retry_anchor_at,
            started_at, finished_at, error, finish_reason,
            step_count, tool_call_count, sql_count, usage jsonb
            idx (thread_id, started_at), (status, heartbeat_at)
            -- replaces ensureNoLiveRun's read-then-insert race handling:
            UNIQUE INDEX one_live_run_per_thread ON runs(thread_id)
              WHERE status = 'running'

run_events: id, run_id → runs, thread_id, type, metadata jsonb, created_at
            idx (run_id, created_at)

artifacts:  id, run_id → runs, thread_id, message_id, type, title,
            payload jsonb, created_at
            idx (run_id, created_at), (thread_id, created_at)

run_chunks: run_id → runs, seq int, body text (JSONL lines), created_at
            PRIMARY KEY (run_id, seq)
```

`stream_id` disappears: the run **is** the stream; clients subscribe by
`run_id`.

## API Surface (Convex → tRPC)

| Convex function | tRPC procedure |
| --- | --- |
| `chat.sendMessage` | `chat.send` (mutation) |
| `chat.editAndRerun` | `chat.editAndRerun` (mutation) |
| `chat.retryLast` | `chat.retry` (mutation) |
| `threads.list / get / create / rename / setPinned / remove` | `threads.*` (remove does the cascade inline in one transaction — no scheduler needed) |
| `messages.list / get` | `messages.list / get` (queries) |
| `runs.latestForThread / get / requestStop` | `runs.latestForThread / get / stop` |
| `artifacts.listForRun` | `artifacts.listForRun` |
| `events.listForRun` | `events.listForRun` |
| `stream.getBody` + `useStream` | `runs.stream` (SSE **subscription**, cursor-based — see below) |
| `agent/drive.drive` (scheduled action) | in-process `startRun(runId)` (fire-and-forget promise in the worker) |
| `node/postgres.*` (`"use node"` actions) | plain calls into `src/lib/sql/pg-executor.ts` — the boundary vanishes |
| `crons` stale sweeper | `setInterval` in the worker |
| internal mutations (`runs.heartbeat/finish`, `events.append`, `artifacts.save`) | worker-side Drizzle helpers, not exposed via tRPC |

Client data fetching: `useQuery(api.threads.list)` →
`trpc.threads.list.useQuery()` with invalidation on mutation (single-user;
nearly all changes are self-inflicted). The run stream is the only push
channel.

## Streaming Subsystem (the core design)

### Write path (worker)

1. The agent loop (ported `convex/agent/loop.ts` → `src/server/run-worker.ts`)
   emits UI-message-part JSONL lines exactly as today (`stream-parts.ts`
   unchanged).
2. Each line goes to two places, synchronously:
   - **RunBus**: `bus.publish(runId, { seq, line })` — subscribers get it
     immediately. Hot path never touches the database.
   - **Chunk buffer**: appended to an in-memory buffer, flushed to
     `run_chunks` as one row when ≥250 ms elapsed or ≥32 KB buffered or the
     line is non-delta (step/tool boundaries — same flush heuristic as the
     current `append(text, flush)`).
3. `seq` increments per flushed row; live lines carry the seq they *will*
   persist under, so replay and tail dedupe cleanly.
4. Per step, the loop stamps `runs.heartbeat_at` and reads `stop_requested`
   (one small UPDATE … RETURNING — unchanged semantics).

### Read path (client)

`runs.stream` subscription input: `{ runId, afterSeq }`.

1. Server reads `run_chunks WHERE run_id = $1 AND seq > $2 ORDER BY seq` and
   yields them (catch-up replay).
2. Subscribes to RunBus and yields live lines with `seq >` the last replayed
   value (dedupe by seq covers the replay/tail overlap).
3. Ends when it yields a terminal line (finish/error) or the run row is no
   longer `running`.
4. SSE ids are the seq, so `httpSubscriptionLink`'s automatic reconnect
   resumes from the right cursor for free. Refresh and second tabs replay from
   `afterSeq = 0` — **incrementally**, never the O(N²) whole-body re-read.

### Client reducer

`useRunStream` is rewritten around an **incremental** reducer: new lines are
folded into persistent reducer state (`reduceChunks` gains an
`(state, line) → state` form; `parseStreamBody`/full-body reduce stays for
finalized messages read from `messages.parts`). O(1) work per chunk — this is
the smoothness fix.

### Liveness, stop, drain

- **Stop**: `runs.stop` sets `stop_requested`; the loop observes it per step
  (unchanged).
- **Sweeper**: `setInterval` 60 s — finalize runs where
  `status = 'running' AND heartbeat_at < now() - STALE_MS`, preserving partial
  output as a visible failed message (port of `finalizeInterruptedRun`, which
  now reads partial parts from `run_chunks`).
- **Deploy drain**: on SIGTERM, stop accepting new runs, give in-flight runs a
  grace window (Railway default 30 s, configurable), then flush buffers and
  finalize survivors as failed-with-partial-output. Same user-visible failure
  mode as a stale heartbeat, but triggered deliberately and with no lost
  chunks.
- **Claim races**: `ensureNoLiveRun` becomes: inside the send/edit/retry
  transaction, `SELECT … FOR UPDATE` the latest run; if running-and-fresh →
  reject; if running-and-stale → finalize inline; the
  `one_live_run_per_thread` partial unique index backstops any race.

## Frontend Changes

| File | Change |
| --- | --- |
| `src/components/chat/useRunStream.ts` | rewrite: tRPC subscription + incremental reducer |
| `src/components/ChatApp.tsx`, `sidebar/Sidebar.tsx`, `sidebar/SearchModal.tsx`, `chat/Conversation.tsx`, `artifacts/ArtifactPanel.tsx` | `useQuery(api.*)`/`useMutation` → tRPC hooks + invalidation |
| `src/lib/convexApi.ts`, Convex provider in the root layout | replaced by tRPC provider + client |
| `src/lib/agent/*`, `src/lib/sql/*`, `src/lib/skills/*`, TUI, evals | **unchanged** |

Search (`SearchModal`) moves from a Convex query to SQL `ILIKE` in V1, with an
obvious upgrade path to Postgres full-text (`tsvector`) later.

## V2 Readiness

- **Auth (BetterAuth or Clerk)**: every table already carries `user_id text`;
  tRPC context resolves the session and procedures filter by it (replacing the
  `ANON_USER_ID` constant with `ctx.userId`). BetterAuth stores its tables in
  this same Postgres — no extra service; Clerk swaps in as a context resolver
  only. No schema migration either way.
- **Langfuse**: the shared runner (`src/lib/agent/run.ts`) is the single
  choke point. Enable AI SDK OpenTelemetry (`experimental_telemetry`) with the
  Langfuse OTel exporter; `run_id`/`thread_id`/`user_id` become trace
  attributes. `run_events` remains the in-app substitute until then.
- **Scale-out**: if the app ever runs >1 replica, RunBus swaps for Redis
  pub/sub behind the same interface; nothing else changes.

## Migration Plan

Dev data is disposable — no data migration. (Optionally `npx convex export`
a snapshot first.)

1. **Foundation**: Railway app Postgres; Drizzle schema + migrations; `pg`
   pool over the private URL; tRPC scaffolding (server, provider,
   `httpSubscriptionLink`); custom server entry that boots Next + worker +
   sweeper. Env vars move from `npx convex env` to Railway service variables
   (`.env.local` for dev; docker-compose Postgres or reuse the pglite path).
2. **CRUD parity**: port `threads/messages/runs/artifacts/events` to tRPC
   procedures + Drizzle; swap the five component files to tRPC hooks. App
   works except live streaming (messages appear on completion).
3. **Streaming subsystem**: RunBus, chunk buffer/flush, `runs.stream`
   subscription, incremental `useRunStream`, port `loop.ts`/`webDeps.ts`/
   `demo.ts` into the worker (`demo.ts` keeps `MODEL_PROVIDER=mock` working).
   Port send/edit/retry with transactional claim.
4. **Lifecycle hardening**: sweeper, SIGTERM drain, stop, verify via the
   `/verify` skill: refresh mid-run, second tab, stop, retry, edit-and-rerun,
   kill -9 the server mid-run → sweeper recovers.
5. **Removal**: delete `convex/`, drop `convex` + `@convex-dev/*` deps,
   remove `NEXT_PUBLIC_CONVEX_*`, update README/CLAUDE.md/specs 01 & 05,
   deploy to Railway.

Each phase leaves `main` shippable except the window inside phase 2–3 on this
branch.

## Tradeoffs Accepted

- We own migrations, hosting, monitoring, and cache invalidation (bounded:
  single-user V1, one push channel).
- Deploys interrupt live runs (mitigated by drain; acceptable — same failure
  mode exists today when the Convex action dies).
- Sidebar/search lose automatic reactivity across tabs until/unless we add a
  push-invalidation topic.
- Single-process design: vertical scaling only, until the Redis swap.

What we get back: no metered reads (the per-chunk hot path never touches the
database), O(1) client work per chunk, one database technology, no
`"use node"` boundary, no action time limits, and infrastructure that already
matches the V2 roadmap (BetterAuth in the same Postgres, OTel→Langfuse,
long-running durable workers).
