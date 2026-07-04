# Schema (verified against the live database on 2026-07-04)

All three tables live in the Postgres schema **`aiqa`** — always schema-qualify
(`aiqa.malls`), the connection's search_path may not include it. Verify with
`describeTable` if a query errors on a column.

Approximate row counts: 337 cities, ~34k malls, ~764k stores.

## aiqa.cities

One row per city, keyed by the city name. There is no numeric id.

| column    | type | nullable | notes                                              |
| --------- | ---- | -------- | -------------------------------------------------- |
| city      | text | no       | primary key, e.g. `上海市`, `北京市`               |
| province  | text | no       | e.g. `广东省`; municipalities repeat the city name |
| city_tier | text | no       | `一线`, `新一线`, `二线`, `三线`, `四线`, `五线`   |
| region    | text | no       | `华东地区`, `华北地区`, `华南地区`, `华中地区`, `西南地区`, `西北地区`, `东北地区` |

## aiqa.malls

| column                | type    | nullable | notes                                             |
| --------------------- | ------- | -------- | ------------------------------------------------- |
| id                    | text    | no       | primary key, code like `WandaPlaza-v-CHN-75`      |
| name                  | text    | no       | mall name (Chinese)                               |
| district              | text    | no       | district within the city, e.g. `朝阳区`            |
| city                  | text    | no       | join key → `cities.city` (by name; no FK id)      |
| province              | text    | no       |                                                   |
| address               | text    | no       | street address                                    |
| status                | text    | no       | see "Status values" below                         |
| open_date             | date    | yes      | opening date                                      |
| real_estate_developer | text    | yes      | developer group, e.g. `中粮集团`                   |
| market_positioning    | text    | yes      | `奢华`, `高端`, `中端`, `平价`, `个体`               |
| rank                  | text    | yes      | curated rating, e.g. `District Leader`, `Destination`; null for ~90% of malls |
| shopping_area         | text    | yes      | trade area / 商圈 the mall belongs to              |
| shopping_area_rank    | text    | yes      | rating of that trade area                         |
| area                  | numeric | yes      | floor area in m²                                  |
| close_date            | date    | yes      | set when the mall has closed                      |

## aiqa.stores

| column        | type    | nullable | notes                                         |
| ------------- | ------- | -------- | --------------------------------------------- |
| id            | text    | no       | primary key, `<sku>-CHN-<n>`                  |
| sku           | text    | no       | brand-level code shared by all stores of a brand, e.g. `StarBucks-s` |
| brand_name    | text    | no       | English brand name, e.g. `LI-NING FACTORY STORE` |
| brand_name_cn | text    | no       | Chinese brand name, e.g. `李宁优惠工厂店`        |
| category      | text    | no       | English category, e.g. `F&B`, `Sport`         |
| category_cn   | text    | no       | Chinese category, e.g. `餐饮美食`, `运动户外`    |
| mall_id       | text    | no       | join key → `malls.id`                         |
| status        | text    | no       | see "Status values" below                     |
| floor         | text    | yes      | e.g. `L2`, `B1`                               |
| open_date     | date    | yes      |                                               |
| close_date    | date    | yes      |                                               |
| area          | numeric | yes      | store area in m²                              |

## Status values

Both `malls.status` and `stores.status` use the same enum:
`OPEN`, `CLOSED`, `DEAD`, `INITIAL`, `PLANNED`, `REMODELLING_OPEN`,
`REMODELLING_CLOSED`.

Observed distribution (live, 2026-07-04): ~75% of malls are `INITIAL`
(imported but not yet verified), only ~2k are `OPEN`; stores split roughly
evenly between `OPEN` (~336k) and `CLOSED` (~359k) with ~64k `INITIAL`.
See the skill's "Operating status" section for how to filter and disclose.

## Store categories (top by store count)

`F&B`/`餐饮美食`, `Women's Clothing`/`女装`, `Men and Women's Clothing`/`男女装`,
`Sport`/`运动户外`, `Jewellery Watches Gifts`/`珠宝饰品`, `Shoes`/`鞋`,
`Men's Clothing`/`男装`, `Beauty`/`护肤化妆品`,
`Electronics & Appliance`/`数码电器`, `Children, Maternity & Baby`/`母婴儿童`.

## What the data does NOT contain

No revenue, sales, foot traffic, lease/tenancy terms, or rent data. Size and
quality proxies available instead: store counts, `area`, `rank`,
`market_positioning`, `shopping_area_rank`. Time analysis is possible via
`open_date` / `close_date` (openings, closures, age), but there are no
periodic measurements.
