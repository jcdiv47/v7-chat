# Glossary

- **City** — a geographic location that contains zero or more malls
  (`aiqa.cities`, keyed by name, with `city_tier` and `region`).
- **Mall** — a shopping center located in exactly one city (`aiqa.malls`,
  joined to cities by name). May contain zero or more stores.
- **Store** — an individual retail tenant located in exactly one mall
  (`aiqa.stores`, joined by `mall_id`).
- **Brand** — a retail chain identified by `sku` (brand-level code, e.g.
  `StarBucks-s`) or `brand_name` / `brand_name_cn`. One brand has many stores.
- **Status** — lifecycle state of a mall or store: `OPEN`, `CLOSED`, `DEAD`,
  `INITIAL` (imported, not yet verified), `PLANNED`, `REMODELLING_OPEN`,
  `REMODELLING_CLOSED`. "Currently operating" ⇒ `INITIAL`, `OPEN`, or
  `REMODELLING_OPEN`.
- **City tier / 城市等级** — `一线` (tier 1) through `五线` (tier 5) plus
  `新一线` (new tier 1); a common comparison dimension.
- **Trade area / 商圈** — `shopping_area` on malls; the retail district a mall
  belongs to, with its own rating (`shopping_area_rank`).
- **Store count** — number of `stores` rows at whatever grain the question
  implies (per mall, per city, per brand). A rough size proxy, not revenue or
  foot traffic; state the status filter used.
- **Empty mall** — a mall with no store rows. Found with a left join.
- **Mall-less city** — a city with no malls. Found with a left join.
- **Grain** — the level one row represents in a result: city, mall, store, or
  brand.
- **"Best" / "strongest"** — ambiguous. There is no revenue or traffic metric.
  State the ambiguity and answer with the available proxies — store count,
  `area`, `rank`, `market_positioning` — clearly labeled, or ask the user to
  pick a measure.
