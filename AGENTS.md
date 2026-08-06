# Agent guide

Do not change anything in the codebase when in a discussion and without
explicit instruction to do so.

## Architecture

A single long-lived Next.js service backed by **Postgres** (Drizzle ORM) with a
**tRPC** API and SSE streaming — see `docs/specs/01-system-architecture.md`.

- App database schema lives in `src/server/db/schema.ts`; migrations in
  `drizzle/` (`npm run db:generate` after schema changes; they apply
  automatically at boot).
- The agent run loop is in-process (`src/server/run-worker.ts`); live output
  streams over the `runs.stream` tRPC SSE subscription.
- Auth is Clerk and mandatory: every page requires sign-in and the tRPC context
  scopes all data by the Clerk user id. Clerk keys must be set in `.env.local`
  — and at build time, because `NEXT_PUBLIC_*` is inlined into the client
  bundle.
- The agent queries a second, read-only **intermediate** Postgres holding the
  business data (`aiqa.cities`, `aiqa.malls`, `aiqa.stores`).

## Local development

```bash
npm install
docker compose up -d db                # app Postgres on localhost:5433
docker compose up -d intermediate-db   # analytical Postgres on localhost:5434
cp .env.example .env.local             # fill in Clerk keys at minimum
npm run dev                            # http://localhost:3000
```

- Demo mode: `MODEL_PROVIDER=mock` runs a deterministic offline agent — no
  model API key or analytical database needed. Clerk is still required.
- Business data: `./scripts/import-intermediate-csv.sh --dev` loads
  `data/*.csv` into the dev analytical database. Without a reachable
  `INTERMEDIATE_DATABASE_URL`, the TUI and evals fall back to an in-process
  pglite database seeded with the sample dataset (`npm run seed`).

## Deployment

The production stack (`docker-compose.prod.yml`) runs Caddy, the Next.js
service, App Postgres and the intermediate Postgres on one host. Only Caddy
publishes ports; both databases sit on an `internal: true` network and
therefore **cannot publish ports at all** — reach them with
`docker compose exec`. Full reference: `docs/deployment/aws-single-host.md`.

### What a human must prepare first

An agent cannot obtain any of these. Ask for them before starting, and never
print their values back into a transcript or commit them.

| Item | Where it comes from | Notes |
| --- | --- | --- |
| Domain name + DNS | Registrar / Route 53 | A/AAAA record pointing at the host **before** Caddy starts, or ACME fails |
| `ACME_EMAIL` | Ops mailbox | Let's Encrypt expiry notices |
| Clerk production keys | Clerk dashboard → API keys | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is also a **build argument**; changing it needs a rebuild, not just a restart |
| `OPENROUTER_API_KEY` | OpenRouter dashboard | Omit only for `MODEL_PROVIDER=mock` |
| Database passwords | `openssl rand -hex 32`, three times | Hex keeps them URL-safe; Compose interpolates them into connection URLs |
| `data/*.csv` | Source analytical database | Gitignored; copied to the host separately. Headers must match `deploy/postgres/analytics-schema.sql` |
| Host access | SSH key or SSM | 80/443 inbound, 22 restricted, **never** 5432/5433 |
| Admin IP for SSH | Whoever administers the host | Passed to `deploy/ufw-setup.sh --ssh-from`; see "Ports" below |
| Langfuse keys | Langfuse project settings | Optional; tracing is off when unset |

These live in `deploy/aws.env` (production) and `deploy/local.env` (local
rehearsal), both gitignored via `/deploy/*.env`. Start from
`deploy/aws.env.example`.

### Ports

Inbound: TCP 80 and 443 (plus UDP 443 for HTTP/3, optional) from the internet,
TCP 22 from one administrative IP. Nothing else. Caddy is the only service that
publishes a port; the app listens on 3000 inside the Docker network, and both
databases are on an `internal: true` network with no host port.

A Docker port publish writes its own `iptables` rules and is **not** filtered
by ufw — a published port is reachable whether ufw is running or not. Never
tell a human that enabling ufw closes a Docker-published port. What does work:
a rule in the `DOCKER-USER` chain (Docker consults it first and never
overwrites it), binding the publish to `127.0.0.1`, or a cloud security group.

`sudo ./deploy/ufw-setup.sh --ssh-from <admin-ip>` configures the host side of
this without touching any cloud firewall: ufw default-deny for host services,
plus a default-deny `DOCKER-USER` block allowing 80/443, persisted in
`/etc/ufw/after.rules`. `--dry-run` prints the rules without applying them.
Re-running replaces the managed block rather than duplicating it.

When editing those rules by hand, two things bite: `DOCKER-USER` runs after
DNAT, so `--dport` is the *container* port rather than the published host port;
and a blanket `DROP` there also severs the containers' outbound access, so
`RELATED,ESTABLISHED` must be excused first.

### Rehearse locally before touching a host

`docker-compose.local.yml` is the production stack with the app port published,
so it needs no DNS or public certificate. Use a distinct project name so it
never shares volumes with the dev databases in `docker-compose.yml`.

```bash
cp deploy/aws.env.example deploy/local.env   # DOMAIN=localhost, Clerk *test* keys
chmod 600 deploy/local.env
docker compose --env-file deploy/local.env -p v7-chat-local \
  -f docker-compose.prod.yml -f docker-compose.local.yml up -d --build
./scripts/import-intermediate-csv.sh --local
```

Verify: `curl -s http://localhost:3000/api/health` returns `{"status":"ok"}`,
`/` redirects to `/sign-in`, and the app log reports `migrations applied`.
Tear down with `down -v`.

Caddy still terminates TLS with its internal CA, but the host may already be
using 443 — check it from inside the network instead of from the host:

```bash
docker compose --env-file deploy/local.env -p v7-chat-local \
  -f docker-compose.prod.yml -f docker-compose.local.yml \
  exec caddy wget -qO- --no-check-certificate https://localhost/api/health
```

### Production, end to end

Run from the repository root on the host. Every step is idempotent.

```bash
# 1. Configuration
cp deploy/aws.env.example deploy/aws.env && chmod 600 deploy/aws.env
# Fill in every value from the table above.

# 2. Start the stack. Caddy obtains the certificate once DNS resolves; the app
#    waits for both databases, applies Drizzle migrations, then reports healthy.
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml up -d --build
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml ps
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml logs -f app caddy

# 3. Business data, from data/*.csv on the host
./scripts/import-intermediate-csv.sh

# 4. Firewall (host-side; no cloud security group changes needed)
sudo ./deploy/ufw-setup.sh --ssh-from <admin-ip>

# 5. Verify the agent's login is read-only
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml \
  exec intermediate-db sh -lc \
  'PGPASSWORD="$INTERMEDIATE_READONLY_PASSWORD" psql -U v7_readonly -d analytics \
   -c "show default_transaction_read_only"'   # must print `on`
```

Deploying updates is `git pull --ff-only` plus the same `up -d --build`. The
old container drains in-flight runs for `DRAIN_GRACE_MS` before exiting.

### Data imports

`scripts/import-intermediate-csv.sh` targets production by default, `--local`
the rehearsal stack, `--dev` the dev database, and `--url <postgres-url>` any
reachable Postgres. It builds the dataset in an `aiqa_import` staging schema —
load, referential-integrity report, constraints, indexes, `ANALYZE` — and then
renames it into place in one transaction, dropping the old schema afterwards.

Consequences to rely on:

- A refresh is safe while the app is serving; queries never see a partial
  dataset, and reads follow the rename without reconnecting.
- Any failure before the swap leaves the previous dataset live. Fix the CSVs
  and re-run; stale staging schemas are rebuilt automatically.
- The swap replaces the entire schema, so the script refuses to run when `aiqa`
  holds objects it does not build. Move them, or pass
  `IMPORT_ALLOW_EXTRA_OBJECTS=1` to discard them.
- Both datasets coexist during an import — the volume needs ~2× headroom.

### Things that will bite

- One app replica only: live run publication is in-memory.
- Never `docker compose down -v` in production; `-v` deletes database volumes.
- Changing a password in `deploy/aws.env` does not rotate the Postgres role;
  rotate it in the database, then recreate the container.
- The intermediate database's init script (`deploy/postgres/init-intermediate.sh`)
  runs **only** on first volume initialization, so a changed
  `INTERMEDIATE_READONLY_PASSWORD` is not applied to an existing volume.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `jcdiv47/v7-chat`, driven by the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unchanged: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily).
See `docs/agents/domain.md`.
