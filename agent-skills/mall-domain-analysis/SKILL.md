---
name: mall-domain-analysis
description: Use when answering business questions about cities, malls, stores, brands, store counts, mall rankings, city comparisons, and which malls or cities lack stores.
---

# Mall Domain Analysis

You are analyzing Chinese mall/retail data in the Postgres schema `aiqa`, with
three tables: `aiqa.cities`, `aiqa.malls`, `aiqa.stores`. Use this skill to
join correctly, stay grain-aware, and handle operating status explicitly.

## Relationships and joins

- `cities` 1 → many `malls`. The join key is the **city name**:
  `malls.city = cities.city`. There is no numeric city id.
- `malls` 1 → many `stores`: `stores.mall_id = malls.id` (text ids).
- Always schema-qualify table names (`aiqa.malls`); the connection's
  search_path may not include `aiqa`.
- If a query fails because a column is missing, call `describeTable` to confirm
  the real column names before retrying. Do not assume columns you have not seen.

Because the city join is by name, malls whose `city` string has no `cities`
row silently drop out of per-city aggregates. It's currently a clean match,
but if per-city totals look off, run the validation query in
`references/query-patterns.md` and report any orphans as a caveat.

## Operating status

Both malls and stores carry `status`: `OPEN`, `CLOSED`, `DEAD`, `INITIAL`
(imported, not yet verified), `PLANNED`, `REMODELLING_OPEN`,
`REMODELLING_CLOSED`.

- Plain counts ("how many malls…") default to **all rows**; say so in the answer.
- "Currently open / operating" → filter `status in ('INITIAL', 'OPEN', 'REMODELLING_OPEN')`
  and state the filter.
- Most malls are `INITIAL`, so status-filtered mall counts drop sharply relative
  to totals. When that gap matters, disclose it rather than silently picking one.

## Grain discipline

State the grain of every answer:

- **City-level** — one row per city (malls per city, stores per city).
- **Mall-level** — one row per mall (stores per mall, mall rankings).
- **Store-level** — one row per store (listing stores in a mall).
- **Brand-level** — one row per brand (`sku` or `brand_name`), e.g. brands with
  the most stores.

Start from `cities` for geography questions, join `malls` for city-level mall
analysis, and join `stores` for store- or brand-level analysis. `city_tier` and
`region` on cities are good comparison dimensions.

## Brand questions

"How many Starbucks in Shanghai?"-style questions are store counts filtered by
brand: join `stores → malls`, filter the city on `malls.city`, and match the
brand on `brand_name_cn` (Chinese) or `brand_name ilike` (English). Prefer a
`like`/`ilike` match — brand names have variants (e.g. factory outlets) — and
say which stores the pattern matched. State the status filter used.

## Missing-data questions

Use `left join` (not inner join) when the question is about *absence*:

- "malls with no stores" → `malls left join stores`, keep rows where the store
  side is null.
- "cities with no malls" → `cities left join malls` (on city name), keep rows
  where the mall side is null.

## Time and measure questions

`open_date` / `close_date` on malls and stores support opening trends,
closures, and age. There is **no** revenue, sales, foot traffic, lease, or rent
data. If a user asks for those, say what is missing and offer the closest
available proxy — store count, `area` (m²), `rank`, `market_positioning` —
clearly labeled as a proxy, not the requested metric.

See `references/schema.md`, `references/query-patterns.md`, and
`references/glossary.md` for the verified schema, canonical SQL, and term
definitions.
