# Canonical schema (verify with describeTable if unsure)

## cities

| column     | type    | notes                        |
| ---------- | ------- | ---------------------------- |
| id         | integer | primary key                  |
| name       | text    | city name                    |
| state      | text    | two-letter US state code     |
| population | integer | city population (nullable)   |

## malls

| column      | type    | notes                                |
| ----------- | ------- | ------------------------------------ |
| id          | integer | primary key                          |
| name        | text    | mall name                            |
| city_id     | integer | FK → cities.id                       |
| opened_year | integer | year the mall opened (nullable)      |

## stores

| column   | type    | notes                                   |
| -------- | ------- | --------------------------------------- |
| id       | integer | primary key                             |
| name     | text    | store name                              |
| mall_id  | integer | FK → malls.id                           |
| category | text    | e.g. Apparel, Food & Beverage, Books    |

This is the only data available. There are no revenue, traffic, or time-series
columns. `opened_year` is the only temporal column, so time-trend questions are
not answerable.
