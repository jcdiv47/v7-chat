---
name: chart-selection
description: Use when the user asks for a chart, or when a grouped/ranking result would be clearer as a visual. Helps choose the chart type and produce a chart spec.
---

# Chart Selection

Choose a useful chart type and emit a chart spec via the `saveArtifact` tool with
`type: "chartSpec"`.

## Rules

- Use a **table** when exact rows matter or the result is small and detailed.
- Use a **bar** chart for rankings and grouped counts (e.g. stores by city).
- Use a **horizontalBar** chart when category labels are long (mall names).
- Use **no chart** for a single scalar answer.
- Avoid **line** charts unless there is a real time column. This dataset's only
  temporal column is `malls.opened_year`; do not fake a time series.

## Chart spec shape

```json
{
  "type": "bar | horizontalBar | line | table | none",
  "title": "Stores by city",
  "x": "city_name",
  "y": "store_count",
  "sourceSql": "select c.name as city_name, count(s.id) as store_count ..."
}
```

- `x` is the dimension (category) column; `y` is the measure column. They must
  match column names in the result table.
- Include `title` and, when possible, the source SQL so the chart is traceable.
- Save the chart spec *after* you have the result, so `x` / `y` reference real
  columns.
