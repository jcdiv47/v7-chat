---
name: chart-selection
description: Use when the user asks for a chart, or when a grouped/ranking result would be clearer as a visual. Helps choose the view type and call the presentData tool.
---

# Chart Selection

Present a query result as an inline view with the `presentData` tool. The view
references the result by id — you never re-type rows.

## The `resultId` convention

- Every successful `runSql` output includes a `resultId`. Echo it into
  `presentData` to say which result the view visualizes.
- If you ran exactly one query this turn you may omit `resultId`.
- Results are thread-scoped: to re-present an earlier turn's result (e.g.
  "show that as a line instead"), reuse its `resultId` — do not re-run the SQL.

## Input shape

```json
{
  "title": "Stores by city",
  "type": "table | bar | line | scatter | stat",
  "resultId": "<from the runSql output>",
  "x": "city_name",
  "y": "store_count"
}
```

Optional per type: `columns` (table: subset/order), `horizontal` + `sort` +
`limit` (bar), `y` as an array of up to 5 columns (line: multi-series),
`sizeBy` (scatter), `caption` (stat), `format` (`number | currency | percent |
compact`, applied to the measure).

## Per-variant rules

- **table** — when exact rows matter or the result is small and detailed.
- **bar** — rankings and grouped counts (e.g. stores by city). Set
  `horizontal: true` when category labels are long (mall names). When the
  result has more than ~20 rows, always pass `sort: "desc"` and a `limit`
  (max 50) — a bar per every row of a long result is unreadable.
- **stat** — a single-scalar answer (one row, one number). Pass the value
  column as `y`. Never chart a single scalar as a one-bar chart.
- **line** — only over a real temporal column. This dataset's only one is
  `malls.opened_year`; do not fake a time series out of categories.
- **scatter** — only genuine numeric-vs-numeric relationships (both `x` and
  `y` numeric measures), which this dataset rarely has.

## Rules

- Call `presentData` *after* the result exists (so `x` / `y` reference real
  columns from the output) and *before* writing your final answer.
- `x` / `y` must exactly match column names in the result. If the tool returns
  `{ ok: false, error }`, fix the input per the error and call it again.
- One view per distinct result is usually enough; skip the view when it would
  not aid interpretation (tiny result, pure lookup).
