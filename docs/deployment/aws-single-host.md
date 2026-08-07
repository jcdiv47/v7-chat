# AWS single-host deployment

The production deployment runs the application and both PostgreSQL databases
on one EC2 instance with Docker Compose. It intentionally runs one application
replica because live run publication is in memory.

```text
Internet -> Caddy (80/443) -> Next.js app (3000)
                              |-- App Postgres
                              `-- Intermediate Postgres (read-only app role)
```

Only Caddy publishes host ports. PostgreSQL and the application communicate on
private Docker networks; neither database has a host or public port.

## 0. Rehearse the stack locally

Run the same images and topology on a workstation before touching an instance.
`docker-compose.local.yml` publishes the app port so the stack is reachable
without DNS or a public certificate; nothing else changes.

```bash
cp deploy/stack.env.example deploy/rehearsal.env   # Clerk *test* keys, throwaway passwords
chmod 600 deploy/rehearsal.env                     # DOMAIN=localhost
docker compose --env-file deploy/rehearsal.env -p v7-chat-local \
  -f docker-compose.prod.yml -f docker-compose.local.yml up -d --build
```

Use a separate project name (`-p v7-chat-local`) so the rehearsal never shares
volumes with the dev database in `docker-compose.yml`. The app is then at
<http://localhost:3000> and `/api/health` returns `{"status":"ok"}` once
migrations have run. Caddy still terminates TLS with its internal CA, but a
host may already be using 443 — verify Caddy from inside the network instead:

```bash
docker compose --env-file deploy/rehearsal.env -p v7-chat-local \
  -f docker-compose.prod.yml -f docker-compose.local.yml \
  exec caddy wget -qO- --no-check-certificate https://localhost/api/health
```

Both databases stay on the internal network, as in production, so business data
is loaded through the admin login rather than a published port. With the CSV
files in `data/` (see step 4), that is the same script production uses:

```bash
./scripts/import-intermediate-csv.sh --local
```

To rehearse against the small built-in sample dataset instead of the real CSVs:

```bash
npx tsx -e "import {DATA_SQL, SCHEMA_SQL} from './src/lib/sql/seed'; \
  process.stdout.write(SCHEMA_SQL + '\n' + DATA_SQL)" > /tmp/seed.sql
docker compose --env-file deploy/rehearsal.env -p v7-chat-local \
  -f docker-compose.prod.yml -f docker-compose.local.yml \
  exec -T intermediate-db psql -U intermediate_admin -d analytics \
  -v ON_ERROR_STOP=1 < /tmp/seed.sql
```

Tear the rehearsal down with `down -v` to discard its volumes.

Day-to-day development doesn't need this stack at all: `docker compose up -d
intermediate-db` starts an analytical Postgres on `localhost:5434` for
`npm run dev`, and `./scripts/import-intermediate-csv.sh --dev` loads the same
CSV files into it.

## 1. Prepare the instance

Use a current Ubuntu LTS EC2 instance with enough RAM and disk for the
intermediate dataset and analytical queries. Put Docker's data directory on an
EBS volume sized for both databases, WAL growth, image layers, and headroom.
Enable EBS encryption.

Install Docker Engine with the Compose plugin, clone the repository, and point
the deployment domain's DNS record at the instance.

### Ports and firewall

The stack needs exactly three inbound ports. Everything else is either internal
to Docker or outbound.

| Port | Source | Why |
| --- | --- | --- |
| TCP 80 | Internet | ACME HTTP-01 challenge and the redirect to HTTPS |
| TCP 443 | Internet | The application |
| UDP 443 | Internet | HTTP/3. Optional — clients fall back to TCP |
| TCP 22 | Internet | SSH; optionally restrict with `--ssh-from <admin-ip>` |

Nothing else should be reachable. Only Caddy publishes ports: the app listens
on 3000 inside the `frontend` Docker network, and both databases sit on a
`backend` network declared `internal: true`, so they have no host port at all
and cannot be given one. Do not open 5432 or 5433. The instance needs outbound
HTTPS for image pulls, Clerk, OpenRouter, and optional Langfuse traffic.

This can be enforced entirely on the host, without editing a cloud security
group — but it takes two mechanisms, not one, because ufw alone does not see
container traffic:

> Docker publishes a port by writing its own `iptables` rules into the `nat`
> and `DOCKER` chains, which are traversed *before* ufw's rules in the `filter`
> chain. A published port is reachable **whether or not ufw is running, and
> regardless of any `ufw deny` rule covering it.**
>
> The chain Docker does consult first — and never overwrites — is
> `DOCKER-USER`. That is the supported place to filter traffic destined for
> containers.

So: **ufw** governs traffic terminating on the host (sshd, and anything that
ever starts listening there), and **`DOCKER-USER`** governs traffic forwarded
to containers. `deploy/ufw-setup.sh` configures both:

```bash
sudo ./deploy/ufw-setup.sh              # SSH open to all (default)
sudo ./deploy/ufw-setup.sh --ssh-from <your-admin-ip>  # optional restriction
./deploy/ufw-setup.sh --dry-run         # print the generated rules, change nothing
```

It sets ufw to default-deny inbound, allows SSH from any address by default,
and writes a managed `DOCKER-USER` block into `/etc/ufw/after.rules`, so the
container rules survive both `ufw reload` and a reboot. Pass `--ssh-from` when
you want to restrict SSH to one IP or CIDR. Re-running replaces the block
instead of stacking duplicates. The policy is default-deny with 80/443 allowed,
plus a `RELATED,ESTABLISHED` rule first so the containers keep their outbound
access to Clerk and OpenRouter.

For the stack as it ships, the `DOCKER-USER` policy changes nothing today —
Caddy publishes exactly 80/443 and the databases publish nothing. Its value is
the next accident: a debug port published on a whim, or
`docker-compose.local.yml` started on the server, would otherwise be on the
internet the moment it starts.

Two details that make hand-written rules fail silently:

- `DOCKER-USER` is traversed **after** Docker's DNAT, so `--dport` is the
  *container* port, not the published host port. They coincide for Caddy
  (`80:80`, `443:443`); a publish like `8080:3000` needs `--dport 3000`.
- A blanket `DROP` in `DOCKER-USER` also kills the containers' own outbound
  traffic. Return traffic must be excused first, which is why the generated
  block leads with `--ctstate RELATED,ESTABLISHED -j RETURN` and otherwise
  restricts itself to packets arriving on the external interface.

Belt and braces, the repository also avoids publishing anything that should not
be public: `docker-compose.local.yml` and the dev `docker-compose.yml` bind
their publishes to `127.0.0.1` explicitly.

Verify from another machine once configured:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<domain>/api/health   # 200
nc -z -w3 <host> 5432 && echo REACHABLE || echo blocked                 # blocked
```

## 2. Configure production

```bash
cp deploy/stack.env.example deploy/aws.env
chmod 600 deploy/aws.env
```

Fill every required value. Generate each database password independently:

```bash
openssl rand -hex 32
```

Use Clerk production keys.

[`docs/configuration.md`](../configuration.md) is the reference for every
variable in this file: what it is consumed by, whether it reaches the app
process, how Compose assembles the two database URLs from the passwords, why
changing the Clerk publishable key needs a rebuild rather than a restart, and
why the `aws.env` / `rehearsal.env` naming asymmetry is deliberate and must not
be "fixed".

## 3. Start the stack

From the repository root:

```bash
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml up -d --build
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml ps
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml logs -f app caddy
```

Caddy obtains and renews the TLS certificate after DNS points at the instance.
The app waits for both databases, applies Drizzle migrations to App Postgres,
and then becomes healthy at `/api/health`.

## 4. Load intermediate business data

The first database initialization creates the `aiqa` schema and the
`v7_readonly` login used by the agent. Business data is loaded from three CSV
files through the admin login, without exposing a database port.

Put the files on the instance at `data/` in the repository root — the same
place they occupy in development:

```text
data/cities.csv
data/malls.csv
data/stores.csv
```

They are gitignored, so copy them across separately (`scp`, S3, or an
attached volume). Each file needs a header row whose names and order match the
matching table in [`deploy/postgres/analytics-schema.sql`](../../deploy/postgres/analytics-schema.sql);
export them with `COPY ... TO STDOUT WITH (FORMAT csv, HEADER true)` from the
source database. The files are UTF-8, since city, mall, and store names are
Chinese.

Then run the import from the repository root:

```bash
./scripts/import-intermediate-csv.sh
```

The script targets `deploy/aws.env` and `docker-compose.prod.yml` by default.
It never modifies the live schema in place: the dataset is built in a staging
schema and renamed into position at the end, so a refresh has no window in
which the agent sees empty or half-loaded tables.

1. Refuses to continue if `aiqa` holds objects the import does not build — a
   view or a hand-made table — because the swap replaces the whole schema.
   `IMPORT_ALLOW_EXTRA_OBJECTS=1` discards them instead.
2. Builds `aiqa_import` from
   [`analytics-schema.sql`](../../deploy/postgres/analytics-schema.sql) —
   tables only, since a bulk load is much faster before indexes and foreign
   keys exist.
3. Streams each CSV in with `\copy`, which runs client-side inside the
   container, so the file arrives over stdin and never touches the database
   volume.
4. Reports rows whose references are dangling — `malls.city` into `cities`,
   `stores.mall_id` into `malls`.
5. Applies [`analytics-constraints.sql`](../../deploy/postgres/analytics-constraints.sql):
   foreign keys, indexes, and `ANALYZE`, so the incoming schema arrives with
   statistics the planner can use immediately.
6. Swaps with [`analytics-swap.sql`](../../deploy/postgres/analytics-swap.sql) —
   `aiqa` is renamed to `aiqa_previous` and the staging schema to `aiqa` in one
   transaction, then `aiqa_previous` is dropped afterwards. Sessions resolve
   `aiqa.<table>` per query and the read-only role's `search_path` is `aiqa`,
   so the agent follows the swap without reconnecting; queries already running
   keep their snapshot and finish against the outgoing tables, which the drop
   simply waits for.

Step 4 is a report, but step 5 is enforcement: a dataset with dangling
references fails there — before the swap, so the previous dataset stays live.
Any failure up to step 6 leaves production untouched; fix the CSV files and
re-run. A stale `aiqa_import` from an interrupted run is dropped and rebuilt at
the start of the next one.

Because both datasets exist simultaneously during an import, the database
volume needs headroom for roughly twice the dataset size.

`analytics-schema.sql` grants the read-only role access to anything it creates,
so no manual `GRANT` is needed. Verify the agent login still cannot write:

```bash
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml \
  exec intermediate-db sh -lc \
  'PGPASSWORD="$INTERMEDIATE_READONLY_PASSWORD" psql -U v7_readonly -d analytics -c "show default_transaction_read_only"'
```

The result must be `on`.

## 5. Deploy updates

```bash
git pull --ff-only
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml up -d --build
```

Compose sends SIGTERM to the old app container. The application rejects new
runs, allows active runs to finish for `DRAIN_GRACE_MS`, finalizes survivors,
and then exits. `stop_grace_period` is deliberately longer than the drain
window. Do not use `docker compose down -v`; `-v` deletes database volumes.

Refreshing the business data is independent of an application deploy: replace
the files in `data/` and re-run `./scripts/import-intermediate-csv.sh`. The
staging-and-swap process means this is safe to do while the app is serving.

## 6. Back up and restore

EBS persistence is not a backup. Schedule database-consistent dumps and copy
them off the instance, for example to a versioned, encrypted S3 bucket:

```bash
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml \
  exec -T app-db pg_dump -U v7 -d v7_chat -Fc > "backups/app-$stamp.dump"
docker compose --env-file deploy/aws.env -f docker-compose.prod.yml \
  exec -T intermediate-db pg_dump -U intermediate_admin -d analytics -Fc \
  > "backups/analytics-$stamp.dump"
```

Automate retention and S3 upload outside Compose. Periodically restore both
dumps to a disposable instance to test recovery. EBS snapshots can supplement
but should not replace PostgreSQL-aware backups.

## Operational constraints

- The host is a single failure and maintenance domain.
- Keep one app replica until the in-memory RunBus is replaced by shared pub/sub.
- Monitor free disk, EBS latency, memory/swap, CPU, PostgreSQL connections, and
  slow analytical queries.
- Changing a password in `deploy/aws.env` does not rotate an existing database
  role automatically; rotate it in PostgreSQL and then recreate the app
  container with the matching environment value.
