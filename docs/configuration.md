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
does its own env loading, and a second loader would change which file wins. In
AWS production these same variables reach the app process as container
environment set by `docker-compose.prod.yml`, not by a file the app reads. On
Railway, `.railway/railway.ts` maps Railway service and shared variables onto
this same host-process surface.

**Stack configuration** is read by Docker Compose on the deployment host, from
`deploy/aws.env` (production) or `deploy/rehearsal.env` (local rehearsal)
(template: [`deploy/stack.env.example`](../deploy/stack.env.example)). These are
*interpolation inputs*: Compose substitutes them into
`docker-compose.prod.yml`, which then decides what the app process actually
sees. Several of them — `DOMAIN`, `ACME_EMAIL`, and all three database
passwords — never reach the app process as themselves at all.

They cannot merge because they belong to different machines with different
threat models. The host surface lives on a laptop, is checked out by every
developer, and must never hold a production password. The AWS stack surface
lives on the deployment host, holds every AWS production secret, and must never
be checked out by every developer — both stack files are gitignored via
`/deploy/*.env`. Railway stores the equivalent deployment secrets as sealed
platform variables rather than introducing another checked-in env file.
Merging the file-backed surfaces would mean either shipping production
passwords into every checkout, or asking each developer to configure `DOMAIN`
and ACME for a certificate they will never obtain.

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

## How Railway assembles the deployment

Railway is a second deployment mechanism, not a third application
configuration model. [`.railway/railway.ts`](../.railway/railway.ts) maps its
resources onto the host-process variables above:

- `DATABASE_URL` references the volume-backed `app-db` service's private URL;
  `APP_DB_PASSWORD` is a sealed Railway provisioning input that reaches the app
  only inside that URL.
- `INTERMEDIATE_DATABASE_URL` references `READONLY_DATABASE_URL` exported by
  the custom `intermediate-db` service; that URL contains the read-only role,
  the sealed read-only password, and Railway's private service hostname.
- Clerk and model-provider shared variables reach the app under their existing
  host-process names.
- `INTERMEDIATE_ADMIN_PASSWORD` and `INTERMEDIATE_READONLY_PASSWORD` are sealed
  Railway provisioning inputs. The former reaches only the analytical database;
  the latter reaches that database and reaches the app only inside
  `INTERMEDIATE_DATABASE_URL`.
- The wizard updates the shared `OPENROUTER_APP_URL` after Railway creates its
  public domain; the IaC maps it onto the app service.

The guided setup writes these values directly to Railway; it never creates a
local production env file. Railway supplies ingress, TLS, `PORT`, and hostnames,
so AWS-only `DOMAIN` and `ACME_EMAIL` have no Railway equivalent. Variable
meaning remains defined by the generated host table below and the AWS-only
stack table later in this document.

## Build-time vs. runtime

`NEXT_PUBLIC_*` variables are inlined into the client bundle by Next.js at build
time. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is therefore both a Docker build
argument and a runtime environment variable. Compose passes it explicitly;
Railway makes the mapped service variable available to the Docker build.
**Changing the Clerk publishable key requires a rebuild, not a restart** — a
restarted container keeps serving the old key baked into the JavaScript.

`NEXT_PUBLIC_CLERK_SIGN_IN_URL` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL` are pinned
to `/sign-in` and `/sign-up` in both the Dockerfile and `docker-compose.prod.yml`,
so they are configurable on the host surface only. The configuration checker
deliberately exempts fixed Compose values, so it does not compare these literals
with their app-schema defaults.

## Host process configuration

Set in `.env.local` (development), by `docker-compose.prod.yml` (AWS), or by
Railway service/shared variables. "Required" means the reading component throws
or exits without it.

### When a bad value is caught

Every variable below is declared once in `src/env/variables.ts` and parsed by
`src/env/parse.ts`; no call site repeats a default or a fallback. Production
Compose passes schema-defaulted values through without pinning them, and
`npm run config:check` enforces that rule.

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
| Variable | Capability | Required | Default | Set by | Read by | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | core | Yes (app); No (Drizzle CLI) | none (app); `postgres://v7:v7@localhost:5433/v7_chat` (Drizzle CLI) | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/server/db/client.ts, drizzle.config.ts | a Postgres connection URL (postgres:// or postgresql://) |
| `CLERK_SECRET_KEY` | core | Yes | none | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | Clerk SDK (server) | a Clerk secret key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | core | Yes | none | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | Clerk SDK (clerkMiddleware in src/proxy.ts, React providers) | a Clerk publishable key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | core | No | `/sign-in` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | Clerk SDK | a path to the sign-in page |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | core | No | `/sign-up` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | Clerk SDK | a path to the sign-up page |
| `NEXT_PUBLIC_APP_VERSION` | tracing | No | none | `.env.local` for next dev/build; not exposed by either production target | src/lib/app-version.ts | Used after APP_VERSION and before package.json; inlined at build time when referenced by client code. |
| `MODEL_PROVIDER` | model-provider | No | `openrouter` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts | one of: openrouter, mock |
| `OPENROUTER_API_KEY` | model-provider | No | none | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts | an OpenRouter API key |
| `OPENROUTER_APP_URL` | model-provider | No | `http://localhost:3000` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts (HTTP-Referer attribution header) | an http:// or https:// URL |
| `OPENROUTER_APP_TITLE` | model-provider | No | `v7 Business Analyst` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts (X-Title attribution header) | a title string |
| `MODEL_FAST` | model-provider | No | `openai/gpt-oss-120b:nitro` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts | an OpenRouter model ID for the `fast` alias |
| `MODEL_ANALYST` | model-provider | No | `z-ai/glm-5.2:nitro` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts | an OpenRouter model ID for the `analyst` alias |
| `MODEL_SQL` | model-provider | No | `moonshotai/kimi-k2.6` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts | an OpenRouter model ID for the `sql` alias |
| `MODEL_SUMMARIZER` | model-provider | No | `openai/gpt-oss-120b:nitro` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts | an OpenRouter model ID for the `summarizer` alias |
| `MODEL_FAST_REASONING` | model-provider | No | `low` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts | one of: provider-default, none, minimal, low, medium, high, xhigh |
| `MODEL_ANALYST_REASONING` | model-provider | No | `low` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts | one of: provider-default, none, minimal, low, medium, high, xhigh |
| `MODEL_SQL_REASONING` | model-provider | No | `low` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts | one of: provider-default, none, minimal, low, medium, high, xhigh |
| `MODEL_SUMMARIZER_REASONING` | model-provider | No | `low` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/models/registry.ts | one of: provider-default, none, minimal, low, medium, high, xhigh |
| `INTERMEDIATE_DATABASE_URL` | analytical-database | Yes (web agent); No (TUI and eval runner) | none (web agent); in-process PGlite sample database (TUI and eval runner) | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/server/worker-deps.ts, tui/index.ts, evals/run.ts, scripts/seed-db.ts | The web agent throws when an analytical tool first needs an unset URL. The TUI and eval runner instead use seeded in-process PGlite. |
| `SEED_DATABASE_URL` | analytical-database | No (but the seed script requires this or INTERMEDIATE_DATABASE_URL) | INTERMEDIATE_DATABASE_URL | `.env.local` or the invoking shell | scripts/seed-db.ts | Use a writable admin connection; the app's analytical login should remain read-only. |
| `SQL_STATEMENT_TIMEOUT_MS` | analytical-database | No | `10000` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/sql/executor.ts | a positive whole number of milliseconds |
| `SQL_MAX_ROWS` | analytical-database | No | `500` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/sql/executor.ts | a positive whole number of rows |
| `SQL_MAX_RESULT_BYTES` | analytical-database | No | `700000` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/sql/executor.ts | Bounds serialized and persisted table artifacts. |
| `APP_VERSION` | tracing | No | NEXT_PUBLIC_APP_VERSION, then the version in package.json | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/app-version.ts | a version string |
| `LANGFUSE_PUBLIC_KEY` | tracing | No | none | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/server/telemetry.ts | a Langfuse public key |
| `LANGFUSE_SECRET_KEY` | tracing | No | none | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/server/telemetry.ts | a Langfuse secret key |
| `LANGFUSE_BASE_URL` | tracing | No | https://cloud.langfuse.com (Langfuse SDK) | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/server/telemetry.ts | an http:// or https:// URL |
| `LANGFUSE_ENVIRONMENT` | tracing | No | `development` (host template); `production` (stack) | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/server/telemetry.ts | an environment label |
| `LANGFUSE_RELEASE` | tracing | No | the resolved app version | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/lib/app-version.ts | a release label |
| `DRAIN_GRACE_MS` | lifecycle | No | `25000` | `.env.local` (development); `docker-compose.prod.yml` (AWS production); Railway service/shared variables (Railway) | src/server/sweeper.ts | a positive whole number of milliseconds |
| `NEXT_MANUAL_SIG_HANDLE` | lifecycle | No | none | `Dockerfile` and `docker-compose.prod.yml` (AWS); `.railway/railway.ts` (Railway) | Next.js (set by the Dockerfile, Compose, or Railway IaC) | a truthy string enabling the app's own SIGTERM handler |
<!-- END GENERATED HOST CONFIGURATION -->

### Platform-provided runtime values

These are environment variables, but not configuration inputs: Next.js or the
container runtime supplies them, so they deliberately stay outside the app
schema and both templates.

| Variable | Required | Default | Set by | Read by | Notes |
| --- | --- | --- | --- | --- | --- |
| `NEXT_RUNTIME` | No | set to `nodejs` for the server runtime | Next.js | `src/instrumentation.ts` | Server instrumentation boots only in the Node.js runtime. |
| `NODE_ENV` | No | command-dependent; `production` in the image | Next.js / `Dockerfile` | Next.js | Selects development or production behavior. |
| `PORT` | No | `3000` in the image | `Dockerfile` | Next.js standalone server | Container listen port. |
| `HOSTNAME` | No | `0.0.0.0` in the image | `Dockerfile` | Next.js standalone server | Allows the container to accept network traffic. |
| `NEXT_TELEMETRY_DISABLED` | No | unset in development; `1` in the image | `Dockerfile` | Next.js | Disables Next.js telemetry in image builds and at runtime. |

The database images also receive internal `POSTGRES_USER`, `POSTGRES_DB`, and
`POSTGRES_PASSWORD` values. Compose fixes or derives them in
`docker-compose.prod.yml`; `.railway/railway.ts` fixes both Railway
database/user pairs while mapping sealed password inputs. The intermediate
database initialization script additionally
reads `INTERMEDIATE_READONLY_PASSWORD`. These database-container values are
provisioning details rather than additional app configuration inputs.

## AWS stack configuration

This table applies only to the AWS/rehearsal Compose target. Values are set in
`deploy/aws.env` or `deploy/rehearsal.env`; read by Docker Compose when
interpolating `docker-compose.prod.yml`. Both files are gitignored and should be
`chmod 600`. Required values use Compose's `${VAR:?...}` form, so a missing one
fails the `up` with a message naming the stack surface and pointing back to this
reference.

<!-- BEGIN GENERATED STACK CONFIGURATION -->
| Variable | Capability | Required | Default | Set by | Consumed by | Reaches the app? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `DOMAIN` | stack | Yes | none | `deploy/aws.env` or `deploy/rehearsal.env` | caddy service, OPENROUTER_APP_URL | Only as `https://${DOMAIN}` | Point DNS at the host before starting Caddy; use `localhost` for rehearsal. |
| `ACME_EMAIL` | stack | Yes | none | `deploy/aws.env` or `deploy/rehearsal.env` | caddy service | No | Let's Encrypt expiry notices. |
| `APP_DB_PASSWORD` | stack | Yes | none | `deploy/aws.env` or `deploy/rehearsal.env` | app-db, DATABASE_URL assembly | Only inside DATABASE_URL | Generate with `openssl rand -hex 32`. |
| `INTERMEDIATE_ADMIN_PASSWORD` | stack | Yes | none | `deploy/aws.env` or `deploy/rehearsal.env` | intermediate-db | No | Admin login used by CSV imports, never by the agent. |
| `INTERMEDIATE_READONLY_PASSWORD` | stack | Yes | none | `deploy/aws.env` or `deploy/rehearsal.env` | init-intermediate.sh, INTERMEDIATE_DATABASE_URL assembly | Only inside INTERMEDIATE_DATABASE_URL | The agent's read-only login. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | stack | Yes | none | `deploy/aws.env` or `deploy/rehearsal.env` | Docker build arg and app environment | Yes | Changing it requires a rebuild. |
| `CLERK_SECRET_KEY` | stack | Yes | none | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Server-side Clerk credential. |
| `OPENROUTER_API_KEY` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty enables demo fallback. |
| `MODEL_PROVIDER` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Set `mock` for an offline demonstration. |
| `OPENROUTER_APP_TITLE` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. OpenRouter attribution title. |
| `MODEL_FAST` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Model alias override. |
| `MODEL_ANALYST` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Model alias override. |
| `MODEL_SQL` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Model alias override. |
| `MODEL_SUMMARIZER` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Model alias override. |
| `MODEL_FAST_REASONING` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Reasoning-effort override. |
| `MODEL_ANALYST_REASONING` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Reasoning-effort override. |
| `MODEL_SQL_REASONING` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Reasoning-effort override. |
| `MODEL_SUMMARIZER_REASONING` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Reasoning-effort override. |
| `SQL_STATEMENT_TIMEOUT_MS` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Per-query timeout in milliseconds. |
| `SQL_MAX_ROWS` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Maximum rows returned by a query. |
| `SQL_MAX_RESULT_BYTES` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Maximum serialized size of a persisted table artifact. |
| `DRAIN_GRACE_MS` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Empty falls back to the app schema. Keep below Compose's 40 second stop grace period. |
| `APP_VERSION` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | App version used by tracing and command-line output. |
| `LANGFUSE_PUBLIC_KEY` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Tracing requires both Langfuse keys. |
| `LANGFUSE_SECRET_KEY` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Tracing requires both Langfuse keys. |
| `LANGFUSE_BASE_URL` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Region-specific or self-hosted Langfuse URL. |
| `LANGFUSE_ENVIRONMENT` | stack | No | `production` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Environment label on traces. |
| `LANGFUSE_RELEASE` | stack | No | `empty` | `deploy/aws.env` or `deploy/rehearsal.env` | app environment | Yes | Release label on traces. |
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
