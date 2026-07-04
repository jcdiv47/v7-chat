# v7 Business Analyst

An agentic business data analysis app. Ask natural-language questions about a
small dataset of **cities, malls, and stores**; the agent inspects the schema,
writes and runs **read-only SQL**, and answers with tables, charts, and saved
artifacts — in a Claude-like chat UI with live, resumable streaming.

Built to the specs in [`docs/specs/`](./docs/specs/). Stack: **Next.js** (AI SDK
UI + Tailwind + shadcn-style components) · **Convex** (state, run lifecycle, and
resumable streaming) · **AI SDK v7 `ToolLoopAgent`** · **OpenRouter** · an
intermediate **Postgres** database.

---

## Quick start (offline demo — no API key or database)

```bash
npm install
npx convex dev            # provisions a local backend, writes .env.local, keeps running
# in another terminal:
npx convex env set MODEL_PROVIDER mock   # deterministic offline runner
npm run dev               # http://localhost:3000
```

With no `OPENROUTER_API_KEY` in the Convex deployment (or `MODEL_PROVIDER=mock`),
the chat runs a **deterministic offline demo** that streams reasoning, tool
calls, a result table, and a chart — enough to exercise the whole UI, streaming,
and resumability without any external services.

## Going live (real model + database)

1. **Model** — set an OpenRouter key on the Convex deployment and unset demo mode:
   ```bash
   npx convex env set OPENROUTER_API_KEY sk-or-...
   npx convex env remove MODEL_PROVIDER
   ```
2. **Database** — point at a read-only Postgres containing `cities`, `malls`,
   `stores`:
   ```bash
   npx convex env set INTERMEDIATE_DATABASE_URL postgres://readonly:pw@host:5432/analytics
   ```
   To create a local sample database: `SEED_DATABASE_URL=postgres://... npm run seed`.

Model aliases (`fast`, `analyst`, `sql`, `summarizer`) are defined in
[`src/lib/models/registry.ts`](./src/lib/models/registry.ts) and overridable per
alias with `MODEL_ANALYST=...` etc. See [`.env.example`](./.env.example).

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

- **Resumable streaming.** The chat stream is a **Convex HTTP action** (not a
  Next route), so a run survives client disconnects. The agent's AI SDK UI
  message parts are encoded as **JSONL** and appended to a
  `@convex-dev/persistent-text-streaming` stream — the source of truth for live
  output. The initiating tab drives the stream over HTTP; a refreshed or second
  tab reads the persisted body reactively and decodes the same JSONL. Refresh
  mid-run and the thinking, tool calls, and answer keep streaming.
- **Run liveness.** Each step stamps a heartbeat and checks a stop flag; a
  scheduled sweeper fails runs whose heartbeat goes stale. One run per thread.
- **Tools.** `loadSkill`, `listTables`, `describeTable`, `runSql`,
  `saveArtifact`. Postgres runs in a `"use node"` Convex action; credentials
  never reach the model. `runSql` is guarded to **read-only `SELECT`/`WITH`**
  with a statement timeout and row/size caps.
- **Skills.** Provider-neutral local skills in [`agent-skills/`](./agent-skills/)
  are bundled at build time into a registry the Convex deployment can read; the
  TUI reads them from disk. The agent loads a skill on demand via `loadSkill`.
- **Observability.** Every run records model, skills version, SQL, artifacts, and
  lifecycle events (a V1 substitute for Langfuse).

## Project structure

```
convex/                 Backend: schema, run lifecycle, HTTP action, agent loop, node Postgres
  agent/                loop.ts (runs the agent in the stream), webDeps.ts, demo.ts
  node/postgres.ts      "use node" Postgres actions (pg)
src/lib/
  agent/                run.ts (shared runner), tools.ts, instructions.ts, stream-parts.ts, history.ts
  models/registry.ts    OpenRouter alias registry
  sql/                  read-only guard, executor contract, pg + pglite executors, seed data
  skills/               skill source (bundled registry + disk loader)
src/components/         Claude-like shell: sidebar, search, conversation, thinking/tool folding, artifacts
agent-skills/           mall-domain-analysis, postgres-analysis, business-answer-style, chart-selection
tui/                    TUI entrypoint
evals/                  prompt set + runner
scripts/                skill bundler, DB seeder
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server (bundles skills first) |
| `npx convex dev` | Convex backend + codegen + watch |
| `npm run build` | Production build |
| `npm run tui` | Terminal agent loop |
| `npm run eval` | Eval suite |
| `npm run seed` | Seed a real Postgres with sample data |
| `npm run typecheck` | `tsc --noEmit` |

## V1 scope

Single anonymous user (Clerk is V2). Read-only queries against the intermediate
Postgres only — the model never touches raw business data or writes. Deferred to
V2: auth, Langfuse tracing, durable `WorkflowAgent` jobs, a semantic layer, and a
strict SQL policy engine. See [`docs/specs/00-product-scope.md`](./docs/specs/00-product-scope.md).
