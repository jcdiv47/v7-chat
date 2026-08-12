# Railway infrastructure

[`.railway/railway.ts`](./railway.ts) declares the complete Railway project:
the single-replica app, its private volume-backed Postgres, and the separately
initialized read-only analytical Postgres.

Use the guided setup from the repository root:

```bash
./scripts/setup-railway.sh
```

For direct infrastructure work, preview before applying:

```bash
railway config plan
railway config apply
```

The AWS VPS stack remains independently defined by `docker-compose.prod.yml`.
See `docs/deployment/railway.md` for the Railway runbook.
