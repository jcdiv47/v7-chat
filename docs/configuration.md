# Configuration reference

Every environment variable this project reads, in one place. If you are asking
"where does this variable come from?", the answer is here rather than spread
across a template, a second template, and a Compose file.

## The two surfaces

Configuration splits into two surfaces that never merge.

**Host process configuration** is read by a Node process running on a developer
machine, from `.env.local` (template: [`.env.example`](../.env.example)).
`next dev` and `next build` load that file implicitly; the TUI, the eval runner
and the seed script load it explicitly through `src/env/node.ts` and fall back
to the ambient environment. The Drizzle config deliberately does not — drizzle-kit
does its own env loading, and a second loader would change which file wins. In production these same variables
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

### When a bad value is caught

Every variable below is declared once in `src/env/variables.ts` and parsed by
`src/env/parse.ts`; no call site repeats a default or a fallback.

`bootServer` validates the whole set before it opens a database connection, so
a malformed value fails the deploy rather than the first request that happens to
read it, and the error lists **every** problem at once — fixing configuration is
one pass, not a sequence of restarts. A value that is set but invalid is always
rejected; nothing silently falls back to a default.

What boot does *not* enforce is whether an optional capability is configured.
The OpenRouter key and the analytical database URL are checked at first use, by
code that can say what to do about it, which is why demo mode and a dev server
started before its model key is filled in both still boot. The boot log names
which capabilities came up.

The tables between generated markers come from `src/env/variables.ts` and the
Compose-only declaration in `scripts/configuration-stack.ts`. Do not edit them
by hand. Run `npm run config:generate` after changing either declaration;
`npm run config:check` verifies both the committed output and required template
entries.

<!-- BEGIN GENERATED HOST CONFIGURATION -->
| Variable | Capability | Required | Default | Read by | Notes |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | core | Yes (app); No (Drizzle CLI) | none (app); `postgres://v7:v7@localhost:5433/v7_chat` (Drizzle CLI) | src/server/db/client.ts, drizzle.config.ts | a Postgres connection URL (postgres:// or postgresql://) |
| `CLERK_SECRET_KEY` | core | Yes | none | Clerk SDK (server) | a Clerk secret key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | core | Yes | none | Clerk SDK (clerkMiddleware in src/proxy.ts, React providers) | a Clerk publishable key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | core | No | `/sign-in` | Clerk SDK | a path to the sign-in page |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | core | No | `/sign-up` | Clerk SDK | a path to the sign-up page |
| `NEXT_PUBLIC_APP_VERSION` | tracing | No | none | src/lib/app-version.ts | Used after APP_VERSION and before package.json; inlined into client code at build time. |
| `MODEL_PROVIDER` | model-provider | No | `openrouter` | src/lib/models/registry.ts | one of: openrouter, mock |
| `OPENROUTER_API_KEY` | model-provider | No | none | src/lib/models/registry.ts | an OpenRouter API key |
| `OPENROUTER_APP_URL` | model-provider | No | `http://localhost:3000` | src/lib/models/registry.ts (HTTP-Referer attribution header) | an http:// or https:// URL |
| `OPENROUTER_APP_TITLE` | model-provider | No | `v7 Business Analyst` | src/lib/models/registry.ts (X-Title attribution header) | a title string |
| `MODEL_FAST` | model-provider | No | `openai/gpt-oss-120b:nitro` | src/lib/models/registry.ts | an OpenRouter model ID for the `fast` alias |
| `MODEL_ANALYST` | model-provider | No | `z-ai/glm-5.2:nitro` | src/lib/models/registry.ts | an OpenRouter model ID for the `analyst` alias |
| `MODEL_SQL` | model-provider | No | `moonshotai/kimi-k2.6` | src/lib/models/registry.ts | an OpenRouter model ID for the `sql` alias |
| `MODEL_SUMMARIZER` | model-provider | No | `openai/gpt-oss-120b:nitro` | src/lib/models/registry.ts | an OpenRouter model ID for the `summarizer` alias |
| `MODEL_FAST_REASONING` | model-provider | No | `low` | src/lib/models/registry.ts | one of: provider-default, none, minimal, low, medium, high, xhigh |
| `MODEL_ANALYST_REASONING` | model-provider | No | `low` | src/lib/models/registry.ts | one of: provider-default, none, minimal, low, medium, high, xhigh |
| `MODEL_SQL_REASONING` | model-provider | No | `low` | src/lib/models/registry.ts | one of: provider-default, none, minimal, low, medium, high, xhigh |
| `MODEL_SUMMARIZER_REASONING` | model-provider | No | `low` | src/lib/models/registry.ts | one of: provider-default, none, minimal, low, medium, high, xhigh |
| `INTERMEDIATE_DATABASE_URL` | analytical-database | No | none | src/server/worker-deps.ts, tui/index.ts, evals/run.ts, scripts/seed-db.ts | a Postgres connection URL (postgres:// or postgresql://) |
| `SEED_DATABASE_URL` | analytical-database | No | none | scripts/seed-db.ts | a writable Postgres connection URL |
| `SQL_STATEMENT_TIMEOUT_MS` | analytical-database | No | `10000` | src/lib/sql/executor.ts | a positive whole number of milliseconds |
| `SQL_MAX_ROWS` | analytical-database | No | `500` | src/lib/sql/executor.ts | a positive whole number of rows |
| `SQL_MAX_RESULT_BYTES` | analytical-database | No | `700000` | src/lib/sql/executor.ts | Bounds serialized and persisted table artifacts. Not passed through by production Compose. |
| `APP_VERSION` | tracing | No | none | src/lib/app-version.ts | a version string |
| `LANGFUSE_PUBLIC_KEY` | tracing | No | none | src/server/telemetry.ts | a Langfuse public key |
| `LANGFUSE_SECRET_KEY` | tracing | No | none | src/server/telemetry.ts | a Langfuse secret key |
| `LANGFUSE_BASE_URL` | tracing | No | none | src/server/telemetry.ts | an http:// or https:// URL |
| `LANGFUSE_ENVIRONMENT` | tracing | No | none | src/server/telemetry.ts | an environment label |
| `LANGFUSE_RELEASE` | tracing | No | none | src/lib/app-version.ts | a release label |
| `DRAIN_GRACE_MS` | lifecycle | No | `25000` | src/server/sweeper.ts | a positive whole number of milliseconds |
| `NEXT_MANUAL_SIG_HANDLE` | lifecycle | No | none | Next.js (set by the Dockerfile and docker-compose.prod.yml) | a truthy string enabling the app's own SIGTERM handler |
<!-- END GENERATED HOST CONFIGURATION -->

### Platform-provided runtime values

`NEXT_RUNTIME`, `NODE_ENV`, `PORT`, `HOSTNAME`, and
`NEXT_TELEMETRY_DISABLED` are supplied by Next.js or the Docker runtime rather
than by app configuration, so they deliberately stay outside the app schema.
See `src/env/variables.ts` for the fixed values and consumers.

## Stack configuration

Set in `deploy/aws.env` or `deploy/rehearsal.env`; read by Docker Compose when
interpolating `docker-compose.prod.yml`. Both files are gitignored and should be
`chmod 600`. Required values use Compose's `${VAR:?...}` form, so a missing one
fails the `up` with a message naming the stack surface and pointing back to this
reference.

<!-- BEGIN GENERATED STACK CONFIGURATION -->
| Variable | Capability | Required | Default | Consumed by | Reaches the app? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `DOMAIN` | stack | Yes | none | caddy service, OPENROUTER_APP_URL | Only as `https://${DOMAIN}` | Point DNS at the host before starting Caddy; use `localhost` for rehearsal. |
| `ACME_EMAIL` | stack | Yes | none | caddy service | No | Let's Encrypt expiry notices. |
| `APP_DB_PASSWORD` | stack | Yes | none | app-db, DATABASE_URL assembly | Only inside DATABASE_URL | Generate with `openssl rand -hex 32`. |
| `INTERMEDIATE_ADMIN_PASSWORD` | stack | Yes | none | intermediate-db | No | Admin login used by CSV imports, never by the agent. |
| `INTERMEDIATE_READONLY_PASSWORD` | stack | Yes | none | init-intermediate.sh, INTERMEDIATE_DATABASE_URL assembly | Only inside INTERMEDIATE_DATABASE_URL | The agent's read-only login. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | stack | Yes | none | Docker build arg and app environment | Yes | Changing it requires a rebuild. |
| `CLERK_SECRET_KEY` | stack | Yes | none | app environment | Yes | Server-side Clerk credential. |
| `OPENROUTER_API_KEY` | stack | No | `empty` | app environment | Yes | Empty enables demo fallback. |
| `MODEL_PROVIDER` | stack | No | `empty` | app environment | Yes | Set `mock` for an offline demonstration. |
| `OPENROUTER_APP_TITLE` | stack | No | `v7 Business Analyst` | app environment | Yes | OpenRouter attribution title. |
| `MODEL_FAST` | stack | No | `empty` | app environment | Yes | Empty falls back to the app schema's model alias default. |
| `MODEL_ANALYST` | stack | No | `empty` | app environment | Yes | Empty falls back to the app schema's model alias default. |
| `MODEL_SQL` | stack | No | `empty` | app environment | Yes | Empty falls back to the app schema's model alias default. |
| `MODEL_SUMMARIZER` | stack | No | `empty` | app environment | Yes | Empty falls back to the app schema's model alias default. |
| `MODEL_FAST_REASONING` | stack | No | `empty` | app environment | Yes | Empty falls back to the app schema's reasoning default. |
| `MODEL_ANALYST_REASONING` | stack | No | `empty` | app environment | Yes | Empty falls back to the app schema's reasoning default. |
| `MODEL_SQL_REASONING` | stack | No | `empty` | app environment | Yes | Empty falls back to the app schema's reasoning default. |
| `MODEL_SUMMARIZER_REASONING` | stack | No | `empty` | app environment | Yes | Empty falls back to the app schema's reasoning default. |
| `SQL_STATEMENT_TIMEOUT_MS` | stack | No | `10000` | app environment | Yes | Per-query timeout in milliseconds. |
| `SQL_MAX_ROWS` | stack | No | `500` | app environment | Yes | Maximum rows returned by a query. |
| `DRAIN_GRACE_MS` | stack | No | `25000` | app environment | Yes | Keep below Compose's 40 second stop grace period. |
| `APP_VERSION` | stack | No | `empty` | app environment | Yes | App version used by tracing and command-line output. |
| `LANGFUSE_PUBLIC_KEY` | stack | No | `empty` | app environment | Yes | Tracing requires both Langfuse keys. |
| `LANGFUSE_SECRET_KEY` | stack | No | `empty` | app environment | Yes | Tracing requires both Langfuse keys. |
| `LANGFUSE_BASE_URL` | stack | No | `empty` | app environment | Yes | Region-specific or self-hosted Langfuse URL. |
| `LANGFUSE_ENVIRONMENT` | stack | No | `production` | app environment | Yes | Environment label on traces. |
| `LANGFUSE_RELEASE` | stack | No | `empty` | app environment | Yes | Release label on traces. |
<!-- END GENERATED STACK CONFIGURATION -->

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
