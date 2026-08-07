# Configuration reference

Every environment variable this project reads, in one place. If you are asking
"where does this variable come from?", the answer is here rather than spread
across a template, a second template, and a Compose file.

## The two surfaces

Configuration splits into two surfaces that never merge.

**Host process configuration** is read by a Node process running on a developer
machine, from `.env.local` (template: [`.env.example`](../.env.example)).
`next dev` and `next build` load that file implicitly; the TUI, the eval runner
and the seed script load it explicitly with `process.loadEnvFile(".env.local")`
and fall back to the ambient environment. In production these same variables
reach the app process as container environment, but they are set by
`docker-compose.prod.yml`, not by a file the app reads.

**Stack configuration** is read by Docker Compose on the deployment host, from
`deploy/aws.env` (production) or `deploy/rehearsal.env` (local rehearsal)
(template: [`deploy/stack.env.example`](../deploy/stack.env.example)). These are
*interpolation inputs*: Compose substitutes them into
`docker-compose.prod.yml`, which then decides what the app process actually
sees. Several of them — `DOMAIN`, `ACME_EMAIL`, and all three database
passwords — never reach the app process as themselves at all.

They cannot merge because they belong to different machines with different
threat models. The host surface lives on a laptop, is checked out by every
developer, and must never hold a production password. The stack surface lives on
the deployment host, holds every production secret, and must never be checked
out by every developer — both stack files are gitignored via `/deploy/*.env`.
Merging them would mean either shipping production passwords into every
checkout, or asking each developer to configure `DOMAIN` and ACME for a
certificate they will never obtain.

### Filename asymmetry

`deploy/aws.env` is named for *where* it runs; `deploy/rehearsal.env` is named
for *what it does*. This asymmetry is deliberate. Only the production host ever
holds `aws.env`, and it lives outside any checkout, so its name records the
machine it belongs to. `rehearsal.env` is a local artefact, so its name records
its purpose. Do not "fix" it by renaming: renaming the production file would
force a manual step on the server for no benefit.

## How Compose assembles the database URLs

The app reads two connection strings, and neither appears in a stack env file.
`docker-compose.prod.yml` builds them from passwords:

```yaml
DATABASE_URL: postgresql://v7:${APP_DB_PASSWORD}@app-db:5432/v7_chat
INTERMEDIATE_DATABASE_URL: postgresql://v7_readonly:${INTERMEDIATE_READONLY_PASSWORD}@intermediate-db:5432/analytics
```

The usernames, hostnames, ports and database names are fixed by the Compose
file; only the passwords are configurable. That is why the stack surface asks
for `APP_DB_PASSWORD` rather than a URL, and why the passwords must be
URL-safe — generate each with `openssl rand -hex 32`.

Two consequences follow:

- **Changing a password in a stack env file does not rotate the Postgres
  role.** `POSTGRES_PASSWORD` only takes effect on first initialization of the
  database volume. On an existing volume, editing the file changes the URL the
  app connects with and nothing else, so the app simply fails to authenticate.
  Rotate the role inside the database first (`ALTER ROLE ... PASSWORD`), then
  update the file and recreate the container. The same applies to
  `INTERMEDIATE_READONLY_PASSWORD`, which
  `deploy/postgres/init-intermediate.sh` consumes only on first initialization.
- **`OPENROUTER_APP_URL` is derived, not configured.** In production Compose
  sets it to `https://${DOMAIN}`. It is a host-surface variable only.

## Build-time vs. runtime

`NEXT_PUBLIC_*` variables are inlined into the client bundle by Next.js at build
time. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is therefore both a Docker build
argument and a runtime environment variable in `docker-compose.prod.yml`.
**Changing the Clerk publishable key requires a rebuild (`up -d --build`), not
a restart** — a restarted container keeps serving the old key baked into the
JavaScript.

`NEXT_PUBLIC_CLERK_SIGN_IN_URL` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL` are pinned
to `/sign-in` and `/sign-up` in both the Dockerfile and `docker-compose.prod.yml`,
so they are configurable on the host surface only.

## Host process configuration

Set in `.env.local` (dev) or by `docker-compose.prod.yml` (production).
"Required" means the reading component throws or exits without it.

### App database

| Variable | Required | Default | Read by | Notes |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Yes | none (app); `postgres://v7:v7@localhost:5433/v7_chat` (Drizzle CLI) | `src/server/db/client.ts`, `drizzle.config.ts` | Threads, messages, runs, stream chunks. Dev: `docker compose up -d db`. Migrations apply at boot and via `npm run db:migrate`. |

### Authentication (Clerk)

Auth is mandatory — every page requires sign-in and all data is scoped by Clerk
user id.

| Variable | Required | Default | Read by | Notes |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | none | Clerk SDK, read for you by `clerkMiddleware` (`src/proxy.ts`) and the React providers | Inlined at build time; see [Build-time vs. runtime](#build-time-vs-runtime). |
| `CLERK_SECRET_KEY` | Yes | none | Clerk SDK (server), behind the tRPC context's `auth()` | Never inlined. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | No | `/sign-in` | Clerk SDK | Pinned in production. |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | No | `/sign-up` | Clerk SDK | Pinned in production. |

### Model provider (OpenRouter)

| Variable | Required | Default | Read by | Notes |
| --- | --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | No, but nothing real runs without it | none | `src/lib/models/registry.ts` | Nothing throws when it is missing: `hasRealModel()` returns false and every caller falls back to the deterministic offline demo agent, which needs no analytical database either. Set it for real answers. |
| `MODEL_PROVIDER` | No | unset | `src/lib/models/registry.ts` | Only `mock` is meaningful; any other value is ignored. |
| `OPENROUTER_APP_URL` | No | `http://localhost:3000` | `src/lib/models/registry.ts` | Sent as the `HTTP-Referer` attribution header. Production derives it from `DOMAIN`. |
| `OPENROUTER_APP_TITLE` | No | `v7 Business Analyst` | `src/lib/models/registry.ts` | Sent as the `X-Title` attribution header. |

### Model aliases and reasoning effort

The agent depends on four stable aliases, not on model IDs. The registry reads
every one of these through a local `env(name)` helper over `process.env[name]`,
so **`process.env.MODEL_ANALYST` never appears anywhere in the source** — search
for the bare name (`MODEL_ANALYST`), not for a `process.env.` access.

| Variable | Required | Default | Read by | Notes |
| --- | --- | --- | --- | --- |
| `MODEL_FAST` | No | `openai/gpt-oss-120b:nitro` | `src/lib/models/registry.ts` | Raw OpenRouter model ID for the `fast` alias. |
| `MODEL_ANALYST` | No | `z-ai/glm-5.2:nitro` | `src/lib/models/registry.ts` | The `analyst` alias — the default for interactive chat. |
| `MODEL_SQL` | No | `moonshotai/kimi-k2.6` | `src/lib/models/registry.ts` | The `sql` alias. |
| `MODEL_SUMMARIZER` | No | `openai/gpt-oss-120b:nitro` | `src/lib/models/registry.ts` | The `summarizer` alias. |
| `MODEL_FAST_REASONING` | No | `low` | `src/lib/models/registry.ts` | See the accepted values below. |
| `MODEL_ANALYST_REASONING` | No | `low` | `src/lib/models/registry.ts` | |
| `MODEL_SQL_REASONING` | No | `low` | `src/lib/models/registry.ts` | |
| `MODEL_SUMMARIZER_REASONING` | No | `low` | `src/lib/models/registry.ts` | |

Accepted reasoning values: `provider-default`, `none`, `minimal`, `low`,
`medium`, `high`, `xhigh`. Anything else logs a warning and falls back to the
default. `provider-default` and `none` send nothing, so the provider's own
default applies; the rest are forwarded as `reasoning_effort`.

### Analytical (intermediate) database

| Variable | Required | Default | Read by | Notes |
| --- | --- | --- | --- | --- |
| `INTERMEDIATE_DATABASE_URL` | Yes for the web agent; optional for the TUI and evals | none | `src/server/worker-deps.ts`, `src/lib/sql/pglite-executor.ts`, `scripts/seed-db.ts` | Read-only role against the business data (`aiqa.cities`, `aiqa.malls`, `aiqa.stores`). **When unset, the TUI and eval runner fall back to an in-process pglite database seeded with the sample dataset**, so both run with zero setup; the web worker has no such fallback and throws. Dev: `docker compose up -d intermediate-db` (port 5434). |
| `SEED_DATABASE_URL` | No | falls back to `INTERMEDIATE_DATABASE_URL` | `scripts/seed-db.ts` | A *writable* admin connection for `npm run seed`. The app itself should always use the read-only role. |

### SQL guardrails

Applied identically by both executors in `src/lib/sql/executor.ts`. Any
non-numeric or non-positive value falls back to the default.

| Variable | Required | Default | Read by | Notes |
| --- | --- | --- | --- | --- |
| `SQL_STATEMENT_TIMEOUT_MS` | No | `10000` | `src/lib/sql/executor.ts` | Postgres `statement_timeout` per query. |
| `SQL_MAX_ROWS` | No | `500` | `src/lib/sql/executor.ts` | Row cap; exceeding it marks the result truncated. |
| `SQL_MAX_RESULT_BYTES` | No | `700000` | `src/lib/sql/executor.ts` | Cap on serialized result bytes. Bounds persisted table artifacts, which store capped rows verbatim alongside SQL, title and metadata. Not passed through by `docker-compose.prod.yml` — to change it in production, add it to the app service's `environment` block. |

### Version and tracing

| Variable | Required | Default | Read by | Notes |
| --- | --- | --- | --- | --- |
| `APP_VERSION` | No | `NEXT_PUBLIC_APP_VERSION`, then the `package.json` version | `src/lib/app-version.ts` | Shown in Langfuse Version/Metadata filters and printed by the TUI and eval runner. A bare semver (`1.4.0`) gains a leading `v`; any other value without a leading `v` passes through unchanged; a `v`-prefixed value that is not semver (e.g. `vNext`) is **discarded**, and the next source in the chain wins. |
| `NEXT_PUBLIC_APP_VERSION` | No | none | `src/lib/app-version.ts` | Checked after `APP_VERSION` and before the `package.json` fallback. Set it instead of `APP_VERSION` when the version must also be visible in client code — but then it is inlined at build time. Not set by either template or by Compose. |
| `LANGFUSE_PUBLIC_KEY` | No | none | `src/server/telemetry.ts` | Tracing initializes only when both keys are set *and* a real model is configured. |
| `LANGFUSE_SECRET_KEY` | No | none | `src/server/telemetry.ts` | |
| `LANGFUSE_BASE_URL` | No | `https://cloud.langfuse.com` (SDK default) | `src/server/telemetry.ts` | Set for a region-specific or self-hosted instance. |
| `LANGFUSE_ENVIRONMENT` | No | unset | `src/server/telemetry.ts` | Environment label on traces. Passed explicitly rather than via the SDK's own `LANGFUSE_TRACING_ENVIRONMENT`, which this project does not rely on. |
| `LANGFUSE_RELEASE` | No | whatever `APP_VERSION` resolves to (`APP_VERSION` → `NEXT_PUBLIC_APP_VERSION` → `package.json`) | `src/lib/app-version.ts` | Release label on traces. |

Nothing in the run path depends on Langfuse: it is an async sink, and the app
skips initialization entirely when the keys are absent or it is in demo mode.

### Process lifecycle

These belong to a long-lived server, not to a laptop. In production
`docker-compose.prod.yml` and the Dockerfile set them; there is no reason to set
them in `.env.local`.

| Variable | Required | Default | Set by | Read by | Notes |
| --- | --- | --- | --- | --- | --- |
| `NEXT_MANUAL_SIG_HANDLE` | No | `true` in the container | Dockerfile, `docker-compose.prod.yml` | Next.js | Required for the app's own SIGTERM handler to run; without it Next exits before the drain. |
| `DRAIN_GRACE_MS` | No | `25000` | `docker-compose.prod.yml` (stack surface) | `src/server/sweeper.ts` | How long in-flight runs get to finish on SIGTERM before they are aborted. Keep the Compose `stop_grace_period` (40s) longer than this. |
| `NEXT_RUNTIME` | — | — | Next.js | `src/instrumentation.ts` | Set by the framework. The worker boots only on the `nodejs` runtime. |
| `NODE_ENV`, `PORT`, `HOSTNAME`, `NEXT_TELEMETRY_DISABLED` | — | `production`, `3000`, `0.0.0.0`, `1` | Dockerfile | Next.js | Fixed by the runtime image. |

## Stack configuration

Set in `deploy/aws.env` or `deploy/rehearsal.env`; read by Docker Compose when
interpolating `docker-compose.prod.yml`. Both files are gitignored and should be
`chmod 600`. Required values use Compose's `${VAR:?...}` form, so a missing one
fails the `up` with a message naming the stack surface and pointing back to this
reference.

| Variable | Required | Default | Consumed by | Reaches the app? | Notes |
| --- | --- | --- | --- | --- | --- |
| `DOMAIN` | Yes | none | `caddy` service, `OPENROUTER_APP_URL` | Only as `https://${DOMAIN}` | Point the A/AAAA record at the host **before** starting Caddy, or ACME fails. Use `localhost` for a rehearsal. |
| `ACME_EMAIL` | Yes | none | `caddy` service | No | Let's Encrypt expiry notices. |
| `APP_DB_PASSWORD` | Yes | none | `app-db` (`POSTGRES_PASSWORD`), assembled into `DATABASE_URL` | Only inside the URL | `openssl rand -hex 32`. |
| `INTERMEDIATE_ADMIN_PASSWORD` | Yes | none | `intermediate-db` (`POSTGRES_PASSWORD`) | No | The admin login used by the CSV import, never by the agent. |
| `INTERMEDIATE_READONLY_PASSWORD` | Yes | none | `deploy/postgres/init-intermediate.sh`, assembled into `INTERMEDIATE_DATABASE_URL` | Only inside the URL | The agent's read-only login. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | none | Docker **build arg** *and* app environment | Yes | Changing it needs a rebuild. |
| `CLERK_SECRET_KEY` | Yes | none | app environment | Yes | |
| `OPENROUTER_API_KEY` | No (empty allowed) | empty | app environment | Yes | Empty means demo mode. |
| `MODEL_PROVIDER` | No | empty | app environment | Yes | `mock` for an offline demonstration. |
| `MODEL_FAST`, `MODEL_ANALYST`, `MODEL_SQL`, `MODEL_SUMMARIZER` | No | empty | app environment | Yes | Empty falls back to the registry defaults above. |
| `MODEL_FAST_REASONING`, `MODEL_ANALYST_REASONING`, `MODEL_SQL_REASONING`, `MODEL_SUMMARIZER_REASONING` | No | empty | app environment | Yes | |
| `OPENROUTER_APP_TITLE` | No | `v7 Business Analyst` | app environment | Yes | |
| `APP_VERSION` | No | empty | app environment | Yes | |
| `SQL_STATEMENT_TIMEOUT_MS` | No | `10000` | app environment | Yes | |
| `SQL_MAX_ROWS` | No | `500` | app environment | Yes | |
| `DRAIN_GRACE_MS` | No | `25000` | app environment | Yes | Keep below the 40s `stop_grace_period`. |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_RELEASE` | No | empty | app environment | Yes | |
| `LANGFUSE_ENVIRONMENT` | No | `production` | app environment | Yes | |

Everything else the app process sees in production is fixed by the Compose file
and is not configurable from a stack env file: `DATABASE_URL`,
`INTERMEDIATE_DATABASE_URL`, `OPENROUTER_APP_URL`,
`NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, and
`NEXT_MANUAL_SIG_HANDLE`.

## Script invocation variables

These belong to neither surface — they are set on the command line for a single
script invocation.

| Variable | Required | Default | Read by | Notes |
| --- | --- | --- | --- | --- |
| `DATA_DIR` | No | `data` | `scripts/import-intermediate-csv.sh` | Directory holding `cities.csv`, `malls.csv`, `stores.csv`. |
| `IMPORT_ALLOW_EXTRA_OBJECTS` | No | unset | `scripts/import-intermediate-csv.sh` | Set to `1` to let the schema swap discard objects in `aiqa` that the script did not build. The script refuses to run otherwise. |
| `EXT_IF` | No | default-route network interface | `deploy/ufw-setup.sh` | Override the external interface when it cannot be detected automatically. |

## Related documents

- [`README.md`](../README.md) — quick start and command reference
- [`AGENTS.md`](../AGENTS.md) — architecture and deployment guide for agents
- [`docs/deployment/aws-single-host.md`](./deployment/aws-single-host.md) — the
  full production runbook
- [`docs/specs/01-system-architecture.md`](./specs/01-system-architecture.md) —
  why the service is shaped this way
