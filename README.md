# v7 Business Analyst

An agentic business data analysis app. Ask natural-language questions about a
small dataset of **cities, malls, and stores**; the agent inspects the schema,
writes and runs **read-only SQL**, and answers with tables, charts, and saved
artifacts — in a Claude-like chat UI with live, resumable streaming. Built to the specs in [`docs/specs/`](./docs/specs/).

Stack:

- **Next.js** (one long-lived service: UI, tRPC API, in-process agent worker)
- **Postgres + Drizzle** (state, run lifecycle, persisted stream)
- **tRPC v11** with SSE subscriptions
- **AI SDK v7 `ToolLoopAgent`**
- **OpenRouter**
- an intermediate **Postgres** database.

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

1. **Model** — set `OPENROUTER_API_KEY` in `.env.local` (or the production
   Compose environment) and leave `MODEL_PROVIDER` unset.
2. **Database** — point `INTERMEDIATE_DATABASE_URL` at a read-only Postgres
   containing `cities`, `malls`, `stores`. Either seed the small sample dataset
   (`SEED_DATABASE_URL=postgres://... npm run seed`), or load the real business
   CSVs from `data/`:

   ```bash
   docker compose up -d intermediate-db          # analytical Postgres on localhost:5434
   ./scripts/import-intermediate-csv.sh --dev    # loads data/{cities,malls,stores}.csv
   ```

   `data/*.csv` is gitignored; copy the files in separately. The import builds
   the whole dataset in a staging schema — loading it, verifying the references
   between the three tables, then adding indexes and statistics — and renames
   that schema into place in one transaction, so queries never see a partial
   dataset and a failed import leaves the previous one serving. See
   [`docs/deployment/aws-single-host.md`](./docs/deployment/aws-single-host.md)
   for the production form of the same step.

Model aliases (`fast`, `analyst`, `sql`, `summarizer`) are defined in
[`src/lib/models/registry.ts`](./src/lib/models/registry.ts) and overridable per
alias with `MODEL_ANALYST=...` etc.

## Configuration

Every environment variable — what sets it, what reads it, whether it is
required, and why laptop configuration and deployment-host configuration are
two separate surfaces — is documented in
[`docs/configuration.md`](./docs/configuration.md).

## Deploying (single AWS host)

The production stack in [`docker-compose.prod.yml`](./docker-compose.prod.yml)
runs Caddy, the long-lived Next.js service, App Postgres, and the read-only
intermediate Postgres on one machine. Only Caddy publishes host ports; both
databases stay on the private Docker network. Migrations run when the app
boots, and the app receives a grace period to drain in-flight runs on deploy.

See [`docs/deployment/aws-single-host.md`](./docs/deployment/aws-single-host.md)
for EC2 setup, configuration, data loading, deployment, and backup steps.

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
  run-worker.ts         in-process agent loop
  run-bus.ts            in-memory pub/sub for live chunks
  chunk-writer.ts       RunBus publish + batched run_chunks persistence
  sweeper.ts            stale-run finalizer + SIGTERM drain
src/lib/
  agent/                run.ts (shared runner), tools.ts, instructions.ts, stream-parts.ts, history.ts
  models/registry.ts    OpenRouter alias registry
  sql/                  read-only guard, executor contract, pg + pglite executors, seed data
  skills/               skill source (bundled registry + disk loader)
src/components/         Claude-like shell: sidebar, search, conversation, thinking/tool folding, artifacts
agent-skills/           business-domain-analysis, business-answer-style, chart-selection, asking-clarifications
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
| `docker compose up -d intermediate-db` | Dev analytical Postgres (port 5434) |
| `npm run build` | Production build |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations (also happens at boot) |
| `npm run tui` | Terminal agent loop |
| `npm run eval` | Eval suite |
| `npm run seed` | Seed a real Postgres with sample data |
| `./scripts/import-intermediate-csv.sh --dev` | Load `data/*.csv` into the dev analytical Postgres |
| `npm run typecheck` | `tsc --noEmit` |

## V1 scope

Clerk authentication is mandatory; app data is scoped by Clerk user id in the
Postgres tables. Read-only queries against the intermediate Postgres only — the
model never touches raw business data or writes. Deferred to V2: Langfuse
tracing, durable jobs, a semantic layer, org scoping, and a strict SQL policy
engine. See
[`docs/specs/00-product-scope.md`](./docs/specs/00-product-scope.md).
