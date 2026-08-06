-- Foreign keys, indexes and planner statistics for the intermediate database.
-- Applied by scripts/import-intermediate-csv.sh *after* the CSV load and
-- *before* the staging schema is swapped into place: creating them up front
-- would slow the bulk load down considerably, and building them in staging
-- keeps the live schema untouched until the swap.
--
-- The target schema is the psql variable `schema` (defaults to `aiqa`). Every
-- statement is idempotent, so re-applying to an existing schema is safe.

\if :{?schema}
\else
  \set schema aiqa
\endif

-- Foreign keys. If a load carries rows referencing a missing parent, these fail
-- loudly rather than leaving the dataset silently inconsistent; the import
-- script reports the orphan counts before it gets here. Because they are
-- created inside the staging schema, they point at the staging tables and
-- follow them through the rename.
alter table :"schema".malls drop constraint if exists malls_city_fkey;
alter table :"schema".malls
  add constraint malls_city_fkey foreign key (city) references :"schema".cities (city);

alter table :"schema".stores drop constraint if exists stores_mall_id_fkey;
alter table :"schema".stores
  add constraint stores_mall_id_fkey foreign key (mall_id) references :"schema".malls (id);

-- Indexes for the filters and joins the agent's SQL generates most often:
-- geography and status filters on malls, and mall / brand / category lookups on
-- the much larger stores table.
create index if not exists cities_province_idx on :"schema".cities (province);
create index if not exists cities_city_tier_idx on :"schema".cities (city_tier);
create index if not exists cities_region_idx on :"schema".cities (region);

create index if not exists malls_city_idx on :"schema".malls (city);
create index if not exists malls_province_idx on :"schema".malls (province);
create index if not exists malls_status_idx on :"schema".malls (status);

create index if not exists stores_mall_id_idx on :"schema".stores (mall_id);
create index if not exists stores_brand_name_cn_idx on :"schema".stores (brand_name_cn);
create index if not exists stores_category_cn_idx on :"schema".stores (category_cn);
create index if not exists stores_status_idx on :"schema".stores (status);
create index if not exists stores_sku_idx on :"schema".stores (sku);

-- Keep the read-only role's grants covering anything created above.
select exists (select 1 from pg_roles where rolname = 'v7_readonly') as has_readonly \gset

\if :has_readonly
  grant select on all tables in schema :"schema" to v7_readonly;
\endif

-- Statistics are collected in staging so the planner is ready the moment the
-- schema is swapped in.
analyze :"schema".cities;
analyze :"schema".malls;
analyze :"schema".stores;
