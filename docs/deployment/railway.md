# Railway deployment

Railway is a parallel deployment target. It does not replace or modify the AWS
single-host stack in [`docker-compose.prod.yml`](../../docker-compose.prod.yml).
The authoritative variable semantics remain in
[`docs/configuration.md`](../configuration.md).

## Shape

[`.railway/railway.ts`](../../.railway/railway.ts) declares:

- one `app` service built from the root `Dockerfile` on `main`;
- one private, volume-backed `app-db` Postgres;
- one custom `intermediate-db` Postgres with a persistent volume and the same
  administrative/read-only role split as the AWS stack; and
- one app replica, required while live run publication remains in memory.

Railway provides ingress and TLS, so this target has no Caddy service. Both
Postgres connections use Railway private networking and declare no TCP proxy.
Business CSVs travel over Railway SSH rather than public database access.

## First deployment

Commit the Railway files and ensure local `main` is ready to push. Then run:

```bash
./scripts/setup-railway.sh
```

The wizard signs in or links the project, stores secrets as sealed Railway
shared variables, previews the infrastructure plan, asks before applying it,
creates a Railway domain, guides the Clerk domain step, imports the CSVs, and
verifies the deployment. It never writes credentials or CSV contents into the
repository.

The first apply may ask Railway to authorize access to `jcdiv47/v7-chat`. The
wizard also asks separately before pushing `main`; declining leaves the remote
branch unchanged and makes the wizard safe to resume later.

## Infrastructure changes

Preview every change:

```bash
railway config plan
```

Apply only after reviewing the plan:

```bash
railway config apply
```

Do not manage the same services with `railway.json` or ad-hoc replacements in
the dashboard. Pull deliberate dashboard changes back into the TypeScript IaC
before the next apply.

## Data refresh

With `data/cities.csv`, `data/malls.csv`, and `data/stores.csv` present locally:

```bash
./scripts/import-intermediate-csv.sh --railway
```

This uses `railway ssh` to run `psql` inside `intermediate-db`. The existing
staging-schema import and atomic swap behavior is unchanged; no TCP proxy is
needed.

Verify the agent login after an import:

```bash
railway ssh --service intermediate-db -- sh -lc \
  'psql "$READONLY_DATABASE_URL" -c "show default_transaction_read_only"'
```

It must print `on`.

## Updates and rollback

A push to `main` redeploys the source-backed services. The analytical service
watches only `deploy/railway/intermediate-db/**`, avoiding restarts for ordinary
app changes. See [`docs/configuration.md`](../configuration.md) before rotating
database credentials.

Inspect terminal deployment state before calling an update successful:

```bash
railway deployment list --service app --limit 1 --json
railway deployment list --service intermediate-db --limit 1 --json
```

Use Railway's deployment history to redeploy a known source revision. Keep the
app at one replica until live run publication is externalized.

## Health and logs

```bash
railway logs --service app --lines 200
railway logs --service intermediate-db --lines 200
railway domain list --service app --json
curl -fsS https://<railway-domain>/api/health
```

The app deployment is ready only when Railway reports `SUCCESS`, the health
endpoint returns `{"status":"ok"}`, and app logs report that migrations were
applied.
