# v7 Business Analyst

An agentic business data analysis app. Ask natural-language questions about a
small dataset of **cities, malls, and stores**; the agent inspects the schema,
writes and runs **read-only SQL**, and answers with tables, charts, and saved
artifacts — in a Claude-like chat UI with live, resumable streaming.

Built to the specs in [`docs/specs/`](./docs/specs/). Stack: **Next.js** (one
long-lived service: UI, tRPC API, in-process agent worker) · **Postgres +
Drizzle** (state, run lifecycle, persisted stream) · **tRPC v11** with SSE
subscriptions · **AI SDK v7 `ToolLoopAgent`** · **OpenRouter** · an intermediate
**Postgres** database.

---

## Quick start (offline demo — no model API key)

```bash
npm install
docker compose up -d db   # app Postgres on localhost:5433
cp .env.example .env.local
MODEL_PROVIDER=mock npm run dev   # http://localhost:3000
```

Before starting the app, create a free Clerk app and paste these keys into
`.env.local`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

With `MODEL_PROVIDER=mock` (or no `OPENROUTER_API_KEY`), the chat runs a
**deterministic offline demo** that streams reasoning, tool calls, a result
table, and a chart — enough to exercise the whole UI, streaming, and
resumability without a model provider or analytical database. Clerk auth is
still required for the browser app. Migrations apply automatically at boot.

## Going live (real model + database)

1. **Model** — set `OPENROUTER_API_KEY` in `.env.local` (or Railway service
   variables) and leave `MODEL_PROVIDER` unset.
2. **Database** — point `INTERMEDIATE_DATABASE_URL` at a read-only Postgres
   containing `cities`, `malls`, `stores`. To create a local sample database:
   `SEED_DATABASE_URL=postgres://... npm run seed`.

Model aliases (`fast`, `analyst`, `sql`, `summarizer`) are defined in
[`src/lib/models/registry.ts`](./src/lib/models/registry.ts) and overridable per
alias with `MODEL_ANALYST=...` etc. See [`.env.example`](./.env.example).

## Deploying (Railway)

One service (`next build` / `next start`) plus a Railway Postgres. Set
`DATABASE_URL` to the **private network** URL, plus the model/database vars
above, the Clerk keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
`CLERK_SECRET_KEY`), and `NEXT_MANUAL_SIG_HANDLE=true` so the SIGTERM drain can
finish in-flight runs on deploys. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` must be
present at build time because it is inlined into the client bundle. Migrations
run at boot.

## TUI (fast local iteration)

Runs the **same agent definition** as the web app against a Node Postgres
executor — a real `INTERMEDIATE_DATABASE_URL`, or a seeded in-process **pglite**
database when none is set (zero setup):

```bash
export OPENROUTER_API_KEY=sk-or-...
npm run tui
# ask a question, or: \tables  \describe <t>  \sql <query>  \skills  \quit
```

## Evals

```bash
npm run eval                        # full agent eval (needs OPENROUTER_API_KEY)
MODEL_PROVIDER=mock npm run eval     # offline data-layer checks
```

See [`evals/expected.md`](./evals/expected.md) for the rubric.

---

## How it works

- **Resumable streaming.** Runs are driven by an **in-process worker**
  (fire-and-forget promise), so they survive client disconnects. The agent's AI
  SDK UI message parts are encoded as **JSONL**: each line is published on an
  in-memory **RunBus** (live subscribers get it instantly — the hot path never
  touches the database) and batch-flushed to the `run_chunks` table. Clients
  subscribe over a **tRPC SSE subscription** keyed by seq cursor: refresh
  mid-run or open a second tab and it replays the persisted chunks, then tails
  the bus — folding chunks **incrementally** (O(1) work per chunk).
- **Run liveness.** Each step stamps a heartbeat and checks a stop flag; a
  sweeper interval fails runs whose heartbeat goes stale, and a SIGTERM drain
  finalizes in-flight runs on deploys. One live run per thread, enforced by a
  transactional claim plus a partial unique index.
- **Tools.** `loadSkill`, `listTables`, `describeTable`, `runSql`,
  `saveArtifact`. Postgres runs server-side; credentials never reach the model.
  `runSql` is guarded to **read-only `SELECT`/`WITH`** with a statement timeout
  and row/size caps.
- **Skills.** Provider-neutral local skills in [`agent-skills/`](./agent-skills/)
  are bundled at build time into a registry; the TUI reads them from disk. The
  agent loads a skill on demand via `loadSkill`.
- **Observability.** Every run records model, skills version, SQL, artifacts, and
  lifecycle events (a V1 substitute for Langfuse).

## Project structure

```
src/server/             Backend: Drizzle schema/client, run lifecycle, worker, tRPC routers
  db/                   schema.ts, client.ts (pg Pool), migrate.ts
  trpc/                 routers (chat, threads, messages, runs, artifacts, events) + SSE stream
  run-worker.ts         in-process agent loop (port of the old Convex action)
  run-bus.ts            in-memory pub/sub for live chunks
  chunk-writer.ts       RunBus publish + batched run_chunks persistence
  sweeper.ts            stale-run finalizer + SIGTERM drain
src/lib/
  agent/                run.ts (shared runner), tools.ts, instructions.ts, stream-parts.ts, history.ts
  models/registry.ts    OpenRouter alias registry
  sql/                  read-only guard, executor contract, pg + pglite executors, seed data
  skills/               skill source (bundled registry + disk loader)
src/components/         Claude-like shell: sidebar, search, conversation, thinking/tool folding, artifacts
agent-skills/           mall-domain-analysis, postgres-analysis, business-answer-style, chart-selection
drizzle/                generated SQL migrations
tui/                    TUI entrypoint
evals/                  prompt set + runner
scripts/                skill bundler, DB seeder
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server (bundles skills first) |
| `docker compose up -d db` | Dev app Postgres (port 5433) |
| `npm run build` | Production build |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations (also happens at boot) |
| `npm run tui` | Terminal agent loop |
| `npm run eval` | Eval suite |
| `npm run seed` | Seed a real Postgres with sample data |
| `npm run typecheck` | `tsc --noEmit` |

## V1 scope

Clerk authentication is mandatory; app data is scoped by Clerk user id in the
Postgres tables. Read-only queries against the intermediate Postgres only — the
model never touches raw business data or writes. Deferred to V2: Langfuse
tracing, durable jobs, a semantic layer, org scoping, and a strict SQL policy
engine. See
[`docs/specs/00-product-scope.md`](./docs/specs/00-product-scope.md).
