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
  | "chart";

export type EvalPrompt = {
  prompt: string;
  category: EvalCategory;
  expect: string;
};

export const EVAL_PROMPTS: EvalPrompt[] = [
  // Counting
  { prompt: "How many cities are represented?", category: "counting", expect: "A single count (6) grounded in a query." },
  { prompt: "How many malls are in each city?", category: "counting", expect: "One row per city with mall_count; uses a left join." },
  { prompt: "How many stores are in each mall?", category: "counting", expect: "One row per mall with store_count." },

  // Ranking
  { prompt: "Which city has the most malls?", category: "ranking", expect: "Austin/Denver/SF/Seattle tie at 3; states the tie." },
  { prompt: "Which mall has the most stores?", category: "ranking", expect: "Ranks malls by store count, returns the top one." },
  { prompt: "Show the top 10 malls by store count.", category: "ranking", expect: "Ordered list limited to 10." },
  { prompt: "Compare store counts across cities.", category: "ranking", expect: "City-level store counts, joined through malls." },

  // Join correctness
  { prompt: "List malls with their city.", category: "joins", expect: "malls joined to cities; mall + city columns." },
  { prompt: "List stores with their mall and city.", category: "joins", expect: "stores → malls → cities two-hop join." },

  // Missing data
  { prompt: "Are there malls with no stores?", category: "missing", expect: "Left join + null check; finds Union Station Market." },
  { prompt: "Are there cities with no malls?", category: "missing", expect: "Left join + null check; finds Boise." },

  // Ambiguity
  { prompt: "Which locations are strongest?", category: "ambiguity", expect: "Notes ambiguity; answers with store count as an explicit proxy." },
  { prompt: "What is the best mall?", category: "ambiguity", expect: "Notes there is no performance metric; uses store count as a proxy or asks to clarify." },

  // Unavailable data
  { prompt: "Which mall has the highest revenue?", category: "unavailable", expect: "States revenue is not in the data; does not fabricate." },
  { prompt: "Which city had the fastest growth last quarter?", category: "unavailable", expect: "States there is no time-series/growth data." },
  { prompt: "What is the foot traffic for Golden Gate Plaza?", category: "unavailable", expect: "States traffic data is unavailable." },

  // Chart behavior
  { prompt: "Chart the number of stores by city.", category: "chart", expect: "Bar chart spec with x=city, y=store_count." },
  { prompt: "Show a bar chart of malls by city.", category: "chart", expect: "Bar chart spec with x=city, y=mall_count." },
  { prompt: "Show a table of malls and their city.", category: "joins", expect: "Table output; no chart needed." },
  { prompt: "What is the average number of stores per mall by city?", category: "counting", expect: "City-level average; two-level aggregation." },
];
