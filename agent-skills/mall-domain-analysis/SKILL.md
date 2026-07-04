---
name: mall-domain-analysis
description: Use when answering business questions about cities, malls, stores, store counts, mall rankings, city comparisons, and which malls or cities lack stores.
---

# Mall Domain Analysis

You are analyzing a small business dataset with three tables: `cities`, `malls`,
and `stores`. Use this skill to stay grain-aware and to join correctly.

## Relationships

- `cities` 1 → many `malls` (a mall belongs to one city).
- `malls` 1 → many `stores` (a store belongs to one mall).

Foreign keys:

- `malls.city_id → cities.id`
- `stores.mall_id → malls.id`

If a query fails because a column is missing, call `describeTable` to confirm the
real column names before retrying. Do not assume columns that you have not seen.

## Grain discipline

State the grain of every answer:

- **City-level** — one row per city (e.g. malls per city, stores per city).
- **Mall-level** — one row per mall (e.g. stores per mall, mall rankings).
- **Store-level** — one row per store (e.g. listing stores in a mall).

Start from `cities` for geography questions, join `malls` for city-level mall
analysis, and join `stores` for store-level analysis.

## Missing-data questions

Use `left join` (not inner join) when the question is about *absence*:

- "malls with no stores" → `malls left join stores`, keep rows where the store
  side is null.
- "cities with no malls" → `cities left join malls`, keep rows where the mall
  side is null.

## Data you do NOT have

This dataset has no revenue, sales, foot traffic, lease, tenancy history, or
time-series columns beyond `malls.opened_year`. If a user asks about revenue,
growth, traffic, or "the best/strongest" location by an unavailable measure, say
which data is missing and offer the closest available proxy (for example, store
count as a rough size proxy) — clearly labeled as a proxy, not the requested
metric.

See `references/schema.md`, `references/query-patterns.md`, and
`references/glossary.md` for the confirmed schema, canonical SQL, and term
definitions.
