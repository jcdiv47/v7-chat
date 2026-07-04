---
name: postgres-analysis
description: Use when writing or revising SQL for the analysis. Covers schema inspection, safe read-only query style, aggregation, and iterating after a database error.
---

# Postgres Analysis

Steer SQL generation and query iteration for read-only Postgres analysis.

## Before writing SQL

- Inspect the schema before relying on column names. Use `listTables`, then
  `describeTable` for any table you will query, unless you already saw its columns
  this turn.
- Never guess a column that you have not seen in a `describeTable` result.

## Query style

- Only `SELECT` / `WITH` (read-only) queries are allowed. Writes, DDL, and
  data-modifying CTEs are rejected by the backend.
- Prefer simple CTEs for multi-step analysis; avoid unnecessarily complex SQL.
- Use clear, explicit aliases (`c` for cities, `m` for malls, `s` for stores).
- Use `count(...)`, `group by`, and `order by` for rankings and comparisons.
- Add `limit` for previews and "top N" questions.
- Use `left join` when the question is about missing / empty relationships.

## After running SQL

- Read the result before answering. If it is empty, say so and suggest a
  follow-up rather than inventing rows.
- If the query errors, read the database error and revise (fix the column name,
  the join, or the grouping) — do not repeat the same failing query.
- Keep the SQL you actually ran visible to the user; it is saved as an artifact.

## Reliability limits

Queries run under a statement timeout and a maximum row cap. If a result is
truncated, mention it and offer a more specific or aggregated query.
