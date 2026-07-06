/**
 * V1 eval set (docs/specs/06). 20+ prompts across the required categories, each
 * with an expected-behavior note. Run with `npm run eval`.
 */
export type EvalCategory =
  | "counting"
  | "ranking"
  | "joins"
  | "missing"
  | "ambiguity"
  | "unavailable"
  | "chart"
  | "clarify";

export type EvalPrompt = {
  prompt: string;
  category: EvalCategory;
  expect: string;
  /** clarify category: whether the agent should call askUser (true) or answer
   * without asking (false). */
  expectAsk?: boolean;
};

export const EVAL_PROMPTS: EvalPrompt[] = [
  // Counting
  { prompt: "How many cities are represented?", category: "counting", expect: "A single count (6) grounded in a query." },
  { prompt: "How many malls are in each city?", category: "counting", expect: "One row per city with mall_count; left join on city name (malls.city = cities.city)." },
  { prompt: "How many stores are in each mall?", category: "counting", expect: "One row per mall with store_count." },
  { prompt: "上海有多少家星巴克门店？", category: "counting", expect: "stores → malls join filtered on 上海市 and brand 星巴克/STARBUCKS (2 in the seed); states the status filter used." },

  // Ranking
  { prompt: "Which city has the most malls?", category: "ranking", expect: "上海市 and 北京市 tie at 3; states the tie." },
  { prompt: "Which mall has the most stores?", category: "ranking", expect: "Ranks malls by store count; 上海大悦城 (6) in the seed." },
  { prompt: "Show the top 10 malls by store count.", category: "ranking", expect: "Ordered list limited to 10." },
  { prompt: "Compare store counts across cities.", category: "ranking", expect: "City-level store counts, joined through malls." },

  // Join correctness
  { prompt: "List malls with their city.", category: "joins", expect: "malls joined to cities by name; mall + city columns." },
  { prompt: "List stores with their mall and city.", category: "joins", expect: "stores → malls → cities two-hop join (mall_id, then city name)." },

  // Missing data
  { prompt: "Are there malls with no stores?", category: "missing", expect: "Left join + null check; finds 北京新集市广场." },
  { prompt: "Are there cities with no malls?", category: "missing", expect: "Left join + null check; finds 三沙市." },

  // Ambiguity
  { prompt: "Which locations are strongest?", category: "ambiguity", expect: "Notes ambiguity; answers with store count / area / rank as explicit proxies." },
  { prompt: "What is the best mall?", category: "ambiguity", expect: "Notes there is no revenue metric; uses store count, area, or rank as a labeled proxy or asks to clarify." },

  // Unavailable data
  { prompt: "Which mall has the highest revenue?", category: "unavailable", expect: "States revenue is not in the data; does not fabricate." },
  { prompt: "Which city had the fastest growth last quarter?", category: "unavailable", expect: "States there is no revenue/sales data; may offer store-opening trends from open_date as a labeled proxy." },
  { prompt: "What is the foot traffic at 上海大悦城?", category: "unavailable", expect: "States traffic data is unavailable." },

  // Chart behavior
  { prompt: "Chart the number of stores by city.", category: "chart", expect: "presentData bar view with x=city, y=store_count." },
  { prompt: "Show a bar chart of malls by city.", category: "chart", expect: "presentData bar view with x=city, y=mall_count." },
  { prompt: "How many stores are there in total?", category: "chart", expect: "Chooses a stat view (or none) for the scalar — never a one-bar chart." },
  { prompt: "Rank the cities by store count.", category: "chart", expect: "Charts the ranking unprompted: presentData bar view from the grouped result." },
  { prompt: "Show a table of malls and their city.", category: "joins", expect: "Table output; no chart needed." },
  { prompt: "What is the average number of stores per mall by city?", category: "counting", expect: "City-level average; two-level aggregation." },

  // Clarification questions (askUser)
  { prompt: "How many stores opened recently?", category: "clarify", expectAsk: true, expect: "Asks ONE askUser question (e.g. which timeframe 'recently' means) instead of guessing; no SQL needed before asking." },
  { prompt: "How many malls are in 北京市?", category: "clarify", expectAsk: false, expect: "Clear request — answers with a query, without calling askUser." },
];
