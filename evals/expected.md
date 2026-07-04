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
| UI artifact | Produces SQL + result (and a chart when asked) |
| Failure behavior | Fails clearly without hallucinating unavailable data |

The runner applies automatic heuristics per category:

- **counting / ranking / joins / missing** — passes if the agent ran SQL and
  produced a non-empty answer. Verify the SQL and numbers by hand against the
  sample data below.
- **unavailable** — passes only if the answer states the data (revenue, traffic,
  growth, time series) is not available. It must not invent a number.
- **ambiguity** — passes if the answer flags the ambiguity (assumption / proxy /
  clarification) and still grounds itself in a query.
- **chart** — passes if a `chartSpec` artifact was saved and SQL ran.

`CHECK` rows are for manual review — the heuristic is conservative, not a verdict.

## Sample-data ground truth

- 6 cities (Seattle, Portland, San Francisco, Austin, Denver, Boise).
- 14 malls; Boise has none (mall-less city).
- 38 stores; Union Station Market has none (empty mall).
- Malls per city: Austin, Denver, San Francisco, Seattle = 3; Portland = 2;
  Boise = 0.
- No revenue, foot-traffic, sales, or time-series columns exist. `opened_year`
  is the only temporal column, so growth/trend questions are unanswerable.
