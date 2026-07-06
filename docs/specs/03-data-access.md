# 03 Data Access

## Data Boundary

The agent queries only the intermediate Postgres database. It never queries raw business Postgres.

```txt
Raw Postgres -> materialization pipeline -> Intermediate Postgres -> agent query tool
```

## V1 Database Scope

Current tables:

- `cities`
- `malls`
- `stores`

The implementation should introspect actual columns rather than assuming exact names. Once confirmed, copy the canonical schema into the `mall-domain-analysis` skill.

## Expected Relationship Pattern

The likely relationship pattern is:

```txt
cities 1 -> many malls
malls  1 -> many stores
```

Common foreign keys may be:

- `malls.city_id -> cities.id`
- `stores.mall_id -> malls.id`

Confirm these names through schema inspection.

## Read-Only Role

The database user used by the app must be read-only.

Recommended database-level posture:

- no table writes
- no schema changes
- no function creation
- no temporary table creation unless intentionally allowed
- statement timeout configured
- idle transaction timeout configured
- connection limit configured

## V1 Query Guardrails

V1 does not implement a full SQL governance system, but it must include a basic query envelope:

- only execute SQL through the backend `runSql` tool
- reject statements that obviously are not read-only
- allow `SELECT` and `WITH`
- reject obvious `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`, `COPY`, `CALL`, `DO`
- apply `statement_timeout`
- cap returned rows
- cap serialized result size
- log every SQL statement
- return concise database errors to the model and UI

These are reliability controls, not V2 policy governance.

## Query Tool Contract

Input:

```ts
type RunSqlInput = {
  sql: string;
  purpose?: string;
};
```

Output:

```ts
type RunSqlOutput = {
  columns: Array<{
    name: string;
    type?: string;
  }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  executionTimeMs: number;
  sql: string;
};
```

Error output:

```ts
type RunSqlError = {
  error: string;
  sql: string;
  executionTimeMs?: number;
};
```

## Result Handling

Do not store large full result sets in the app database by default.

Store:

- SQL
- columns
- row count
- preview rows
- truncation flag
- execution time
- artifact references

For V1, a preview of 100-500 rows is enough.

The preview has three consumers with different sizes:

- the model receives the tool result up to `maxRows`
- the artifact stores the full preview (100-500 rows) for the result table and
  expanded tool rows
- the persistent stream's tool-output part carries only columns, row count, and a
  ~20-row preview, to keep the stream body small

Observability records should not carry full result payloads. `run_events` and
dedicated Langfuse SQL observations log the SQL statement, purpose,
success/failure, execution time, and concise error metadata only; the full
100-500 row preview belongs in table artifacts. The model-visible tool result
(up to `maxRows`) will still appear inside Langfuse model-call observations as
part of the recorded model context — that is accepted (see
`06-evals-observability.md` → SQL Trace Policy).

## Useful Starter Questions

Use these for manual testing and evals:

- How many cities are represented?
- How many malls are in each city?
- Which malls have the most stores?
- Which cities have the most stores?
- Are there malls with no stores?
- Which stores are in a given mall?
- Compare store counts across cities.
- What is the average number of stores per mall by city?
- Which city has the highest mall count?
- Show a table of malls and their city.

## Example SQL Patterns

These examples assume conventional key names. Update them after schema inspection.

```sql
select
  c.name as city_name,
  count(distinct m.id) as mall_count
from cities c
left join malls m on m.city_id = c.id
group by c.name
order by mall_count desc;
```

```sql
select
  m.name as mall_name,
  c.name as city_name,
  count(s.id) as store_count
from malls m
join cities c on c.id = m.city_id
left join stores s on s.mall_id = m.id
group by m.name, c.name
order by store_count desc
limit 20;
```

## V2 Data Access Upgrades

- parser-based SQL AST validation
- policy engine
- query cost checks using `EXPLAIN`
- query approval flows
- semantic metrics and dimensions
- tenant-aware row-level controls
- materialized analysis datasets created through approved backend jobs
