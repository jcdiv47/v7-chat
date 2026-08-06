-- Table definitions for the intermediate (analytical) database, matching the
-- `aiqa` schema the agent queries.
--
-- The target schema is the psql variable `schema` (defaults to `aiqa`), because
-- scripts/import-intermediate-csv.sh builds each import in a staging schema and
-- then renames it into place. Foreign keys and indexes come afterwards from
-- analytics-constraints.sql: a bulk load is much faster without them.
--
-- Column order here must match the CSV headers in data/ — \copy binds by
-- position when the header row is skipped.

\if :{?schema}
\else
  \set schema aiqa
\endif

create schema if not exists :"schema";

create table if not exists :"schema".cities (
  city       text primary key,
  province   text not null,
  city_tier  text not null,
  region     text not null
);

create table if not exists :"schema".malls (
  id                    text primary key,
  name                  text not null,
  district              text not null,
  city                  text not null,
  province              text not null,
  address               text not null,
  status                text not null,
  open_date             date,
  real_estate_developer text,
  market_positioning    text,
  rank                  text,
  shopping_area         text,
  shopping_area_rank    text,
  area                  numeric,
  close_date            date
);

create table if not exists :"schema".stores (
  id            text primary key,
  sku           text not null,
  brand_name    text not null,
  brand_name_cn text not null,
  category      text not null,
  category_cn   text not null,
  mall_id       text not null,
  status        text not null,
  floor         text,
  open_date     date,
  close_date    date,
  area          numeric
);

-- The read-only role is created when the volume is first initialized, but the
-- grants there only cover tables that existed at that moment — and a staging
-- schema does not exist yet at that point. Guarded so the file also applies to
-- a database that has no such role (e.g. a scratch import target).
select exists (select 1 from pg_roles where rolname = 'v7_readonly') as has_readonly \gset

\if :has_readonly
  grant usage on schema :"schema" to v7_readonly;
  grant select on all tables in schema :"schema" to v7_readonly;
\endif
