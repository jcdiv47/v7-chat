-- Promote a freshly loaded staging schema to be the live `aiqa` schema.
-- Run by scripts/import-intermediate-csv.sh; the staging schema name is the
-- psql variable `schema`.
--
-- The two renames happen in one transaction, so the agent's read-only sessions
-- see either the whole previous dataset or the whole new one — never an empty
-- or half-loaded table. Sessions resolve `aiqa.<table>` per query, and the
-- read-only role's `search_path` is set to `aiqa`, so both follow the rename
-- without reconnecting. Queries already running against the outgoing tables
-- keep their snapshot and finish normally; the old schema is dropped
-- afterwards, which simply waits for them.

\if :{?schema}
\else
  \warn 'analytics-swap.sql requires -v schema=<staging schema>'
  \quit 1
\endif

select exists (select 1 from pg_roles where rolname = 'v7_readonly') as has_readonly \gset

begin;

-- Anything left over from an interrupted previous swap.
drop schema if exists aiqa_previous cascade;

-- The very first import has no live schema to step aside.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'aiqa') then
    execute 'alter schema aiqa rename to aiqa_previous';
  end if;
end
$$;

alter schema :"schema" rename to aiqa;

-- Default privileges are recorded per schema, so they stayed behind with the
-- outgoing schema. Re-establish them on the incoming one.
\if :has_readonly
  grant usage on schema aiqa to v7_readonly;
  grant select on all tables in schema aiqa to v7_readonly;
  alter default privileges for role intermediate_admin in schema aiqa
    grant select on tables to v7_readonly;
\endif

commit;

-- Outside the transaction: reclaiming the old dataset must not hold the swap
-- open, and this waits for any query still reading the outgoing tables.
drop schema if exists aiqa_previous cascade;
