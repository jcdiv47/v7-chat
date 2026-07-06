# Eval expectations

The prompt set lives in `evals/prompts.ts`, each with an `expect` note. Run the
suite with `npm run eval` (full agent, needs `OPENROUTER_API_KEY`) or offline
(`MODEL_PROVIDER=mock npm run eval`, data-layer checks only).

## Scoring rubric (docs/specs/06)

| Criterion | Pass requirement |
| --- | --- |
| Correct SQL | Query uses valid tables and the right joins |
| Grounded answer | Answer follows from the query result |
| Caveats | Mentions missing data / ambiguity when relevant |
| Skill usage | Loads a relevant skill when useful |
| UI artifact | Produces SQL + result (and a `presentData` view when asked or useful) |
| Failure behavior | Fails clearly without hallucinating unavailable data |

The runner applies automatic heuristics per category:

- **counting / ranking / joins / missing** — passes if the agent ran SQL and
  produced a non-empty answer. Verify the SQL and numbers by hand against the
  sample data below.
- **unavailable** — passes only if the answer states the data (revenue, traffic,
  growth, time series) is not available. It must not invent a number.
- **ambiguity** — passes if the answer flags the ambiguity (assumption / proxy /
  clarification) and still grounds itself in a query.
- **chart** — passes if a successful `presentData` view was saved and SQL ran.
  Legacy `chartSpec` artifacts may still render for old rows, but `presentData`
  is the current eval success path.

`CHECK` rows are for manual review — the heuristic is conservative, not a verdict.

## Sample-data ground truth

- 6 cities: 上海市, 北京市, 深圳市, 沈阳市, 佳木斯市, 三沙市.
- 9 malls; 三沙市 has none (mall-less city).
- 26 stores; 北京新集市广场 has none (empty mall).
- Malls per city: 上海市 = 3; 北京市 = 3; 深圳市 = 1; 沈阳市 = 1;
  佳木斯市 = 1; 三沙市 = 0.
- Store counts by mall: 上海大悦城 = 6; 北京朝阳大悦城 = 5; 上海一方城 = 4;
  深圳海上世界 = 4; 上海老街坊商城 = 2; 北京西单大悦城 = 2; 沈阳中街商城 = 2;
  佳木斯江畔购物中心 = 1; 北京新集市广场 = 0.
- Store counts by city: 上海市 = 12; 北京市 = 7; 深圳市 = 4; 沈阳市 = 2;
  佳木斯市 = 1; 三沙市 = 0.
- No revenue, foot-traffic, sales, or true time-series columns exist. Date
  columns (`open_date`, `close_date`) can support opening-date analysis only;
  growth/trend questions need an explicit caveat or proxy.
