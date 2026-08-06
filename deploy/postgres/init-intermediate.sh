#!/bin/sh
set -eu

# This runs only when the intermediate Postgres volume is first initialized.
# psql's :'name' syntax safely quotes the password as a SQL string literal.
psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=readonly_password="$INTERMEDIATE_READONLY_PASSWORD" <<'SQL'
CREATE ROLE v7_readonly LOGIN CONNECTION LIMIT 10 PASSWORD :'readonly_password';
ALTER ROLE v7_readonly SET default_transaction_read_only = on;
ALTER ROLE v7_readonly SET statement_timeout = '10s';
ALTER ROLE v7_readonly SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE v7_readonly SET search_path = aiqa, public;

REVOKE TEMPORARY ON DATABASE analytics FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS aiqa AUTHORIZATION intermediate_admin;

GRANT CONNECT ON DATABASE analytics TO v7_readonly;
GRANT USAGE ON SCHEMA public, aiqa TO v7_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public, aiqa TO v7_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE intermediate_admin IN SCHEMA public
  GRANT SELECT ON TABLES TO v7_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE intermediate_admin IN SCHEMA aiqa
  GRANT SELECT ON TABLES TO v7_readonly;
SQL
