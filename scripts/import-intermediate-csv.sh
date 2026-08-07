#!/usr/bin/env bash
#
# Load the cities / malls / stores CSV files into the intermediate (analytical)
# database.
#
#   Production (deploy/aws.env, docker-compose.prod.yml):
#     ./scripts/import-intermediate-csv.sh
#
#   Local rehearsal of the production stack (deploy/rehearsal.env):
#     ./scripts/import-intermediate-csv.sh --local
#
#   Dev database from docker-compose.yml, for `npm run dev`:
#     ./scripts/import-intermediate-csv.sh --dev
#
#   Any other reachable Postgres, using the host's psql:
#     ./scripts/import-intermediate-csv.sh --url postgres://admin:pw@host:5432/analytics
#
# The CSV files live in data/ (gitignored — they are copied to the host
# separately) and must carry a header row whose column names and order match
# deploy/postgres/analytics-schema.sql.
#
# In the Compose modes psql runs inside the database container, so nothing needs
# a published port: `\copy` is client-side, and each file is piped in over
# stdin.
#
# The load is a full snapshot, built in a staging schema and renamed into place
# in one transaction. The live `aiqa` schema is never emptied, so the agent
# queries the previous dataset until the new one is complete, and a failed
# import leaves the previous dataset serving.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"

mode=compose
url=
env_file=deploy/aws.env
project=v7-chat
compose_files=(-f docker-compose.prod.yml)
service=intermediate-db

case "${1:-}" in
  --local)
    env_file=deploy/rehearsal.env
    project=v7-chat-local
    compose_files=(-f docker-compose.prod.yml -f docker-compose.local.yml)
    shift
    ;;
  --dev)
    env_file=
    project=v7-chat
    compose_files=(-f docker-compose.yml)
    shift
    ;;
  --url)
    mode=url
    url=${2:?--url needs a Postgres connection string}
    shift 2
    ;;
  --help | -h)
    sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

data_dir=${DATA_DIR:-data}

for table in cities malls stores; do
  if [ ! -f "$data_dir/$table.csv" ]; then
    echo "Missing $data_dir/$table.csv" >&2
    exit 1
  fi
done

if [ "$mode" = compose ] && [ -n "$env_file" ] && [ ! -f "$env_file" ]; then
  echo "Missing $env_file" >&2
  exit 1
fi

psql_admin() {
  if [ "$mode" = url ]; then
    psql "$url" -v ON_ERROR_STOP=1 --quiet "$@"
  elif [ -n "$env_file" ]; then
    docker compose --env-file "$env_file" -p "$project" "${compose_files[@]}" \
      exec -T "$service" \
      psql -U intermediate_admin -d analytics -v ON_ERROR_STOP=1 --quiet "$@"
  else
    docker compose -p "$project" "${compose_files[@]}" exec -T "$service" \
      psql -U intermediate_admin -d analytics -v ON_ERROR_STOP=1 --quiet "$@"
  fi
}

# The live schema is never modified in place: the whole dataset is built in a
# staging schema and renamed into position at the end, so the agent keeps
# querying the previous dataset — at full speed, with statistics — until the
# moment the new one is complete.
staging=aiqa_import

# The swap replaces the whole schema, so anything else living in aiqa — a view,
# a helper table someone added by hand — would be discarded with it. Check
# before spending time on the load, and refuse rather than destroy it silently.
extra=$(psql_admin --tuples-only --no-align -c "
  select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'aiqa'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and c.relname not in ('cities', 'malls', 'stores')")

if [ -n "$extra" ] && [ "${IMPORT_ALLOW_EXTRA_OBJECTS:-}" != "1" ]; then
  cat >&2 <<EOF
Refusing to import: aiqa holds objects this import does not build, and the
swap at the end replaces the entire schema:

  $extra

Move them elsewhere, or re-run with IMPORT_ALLOW_EXTRA_OBJECTS=1 to discard
them along with the old dataset.
EOF
  exit 1
fi

# A staging schema left behind by an interrupted run is stale by definition.
echo "==> Preparing staging schema $staging"
psql_admin -c "drop schema if exists $staging cascade"
psql_admin -v schema="$staging" < deploy/postgres/analytics-schema.sql

for table in cities malls stores; do
  echo "==> Loading $table.csv"
  psql_admin -c "\\copy $staging.$table from stdin with (format csv, header true, encoding 'UTF8')" \
    < "$data_dir/$table.csv"
done

# Report dangling references before the foreign keys are created, so a bad
# dataset produces a count to act on instead of a bare constraint violation.
echo "==> Checking referential integrity"
psql_admin --tuples-only --no-align -c "
  select 'malls referencing an unknown city: ' || count(*)
    from $staging.malls m left join $staging.cities c on c.city = m.city where c.city is null
  union all
  select 'stores referencing an unknown mall: ' || count(*)
    from $staging.stores s left join $staging.malls m on m.id = s.mall_id where m.id is null"

echo "==> Creating constraints and indexes, analyzing"
psql_admin -v schema="$staging" < deploy/postgres/analytics-constraints.sql

echo "==> Staged row counts"
psql_admin -c "
  select relname as table, n_live_tup as rows
    from pg_stat_user_tables where schemaname = '$staging' order by relname"

echo "==> Swapping $staging into place as aiqa"
psql_admin -v schema="$staging" < deploy/postgres/analytics-swap.sql

echo "==> Live row counts"
psql_admin -c "
  select relname as table, n_live_tup as rows
    from pg_stat_user_tables where schemaname = 'aiqa' order by relname"
