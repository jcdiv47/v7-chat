# Glossary

- **City** — a geographic location that contains zero or more malls (`cities`).
- **Mall** — a shopping center located in exactly one city (`malls`). May contain
  zero or more stores.
- **Store** — an individual retail tenant located in exactly one mall (`stores`).
- **Store count** — number of `stores` rows, aggregated at whatever grain the
  question implies (per mall, per city). Use it only as a rough size proxy; it is
  not revenue or foot traffic.
- **Empty mall** — a mall with no stores (`stores` rows). Found with a left join.
- **Mall-less city** — a city with no malls. Found with a left join.
- **Grain** — the level one row represents in a result: city, mall, or store.
- **"Best" / "strongest"** — ambiguous. There is no revenue or performance metric,
  so state the ambiguity and answer with store count as an explicit proxy, or ask
  the user to clarify the intended measure.
