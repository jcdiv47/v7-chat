/**
 * Offline demo runner. When no model provider is configured (MODEL_PROVIDER=mock
 * or a missing OPENROUTER_API_KEY), the chat loop runs this deterministic script
 * instead of the real ToolLoopAgent. It emits the same UI message chunks — so
 * the streaming, resumability, folding UI, artifact panel, and persistence stack
 * are all exercised end-to-end without any external services. Clearly labeled as
 * a demo.
 */
import type { UIMessageChunk } from "ai";
import type { AgentToolDeps } from "../lib/agent/types";

export type DemoResult = {
  finishReason: string;
  steps: number;
  aborted: boolean;
  errorText?: string;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    try {
      setTimeout(resolve, ms);
    } catch {
      resolve();
    }
  });

const REASONING = [
  "This is the offline demo runner (no model provider configured). ",
  "I'll show the shape of a real analysis: inspect tables, run a grouped ",
  "count query, then summarize with a chart.",
];

const SQL = `select c.city, count(m.id) as mall_count
from aiqa.cities c
left join aiqa.malls m on m.city = c.city
group by c.city
order by mall_count desc;`;

const ROWS = [
  { city: "上海市", mall_count: 3 },
  { city: "北京市", mall_count: 3 },
  { city: "深圳市", mall_count: 1 },
  { city: "沈阳市", mall_count: 1 },
  { city: "佳木斯市", mall_count: 1 },
  { city: "三沙市", mall_count: 0 },
];

const ANSWER = `**Answer (offline demo).** Malls are spread across 6 cities, with 上海市 and 北京市 tied at the top (3 malls each), and 三沙市 with none.

**Evidence.** See the grouped count in the result table and the bar chart.

**Caveat.** This is a canned demo response — set \`OPENROUTER_API_KEY\` (and \`INTERMEDIATE_DATABASE_URL\`) in the server environment to get real, model-generated answers over live data.

**Follow-up.** Try "Which malls have the most stores?" once a model and database are configured.`;

function chunkText(text: string, size = 24): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export async function runDemoAnalysis(opts: {
  onChunk: (chunk: UIMessageChunk) => Promise<void> | void;
  saveArtifact: AgentToolDeps["saveArtifact"];
  beforeStep?: (stepNumber: number) => Promise<boolean> | boolean;
}): Promise<DemoResult> {
  const { onChunk, saveArtifact, beforeStep } = opts;
  const emit = async (c: UIMessageChunk) => {
    await onChunk(c);
  };

  const cont = async (step: number) => (beforeStep ? await beforeStep(step) : true);

  await emit({ type: "start" });
  await emit({ type: "start-step" });

  if (!(await cont(0))) return { finishReason: "abort", steps: 0, aborted: true };

  // Reasoning
  await emit({ type: "reasoning-start", id: "r1" });
  for (const piece of REASONING) {
    await emit({ type: "reasoning-delta", id: "r1", delta: piece });
    await sleep(60);
  }
  await emit({ type: "reasoning-end", id: "r1" });

  // Tool: listTables
  await emit({ type: "tool-input-start", toolCallId: "t1", toolName: "listTables" });
  await emit({ type: "tool-input-available", toolCallId: "t1", toolName: "listTables", input: {} });
  await sleep(80);
  await emit({
    type: "tool-output-available",
    toolCallId: "t1",
    output: {
      tables: [
        { name: "cities", rowEstimate: 6 },
        { name: "malls", rowEstimate: 9 },
        { name: "stores", rowEstimate: 26 },
      ],
    },
  });

  if (!(await cont(1))) return { finishReason: "abort", steps: 1, aborted: true };

  // Tool: runSql
  await emit({ type: "tool-input-start", toolCallId: "t2", toolName: "runSql" });
  for (const piece of chunkText(JSON.stringify({ sql: SQL, purpose: "malls per city" }), 40)) {
    await emit({ type: "tool-input-delta", toolCallId: "t2", inputTextDelta: piece });
    await sleep(30);
  }
  await emit({
    type: "tool-input-available",
    toolCallId: "t2",
    toolName: "runSql",
    input: { sql: SQL, purpose: "malls per city" },
  });
  await sleep(120);
  await emit({
    type: "tool-output-available",
    toolCallId: "t2",
    output: {
      ok: true,
      columns: [
        { name: "city", type: "text" },
        { name: "mall_count", type: "int8" },
      ],
      rows: ROWS,
      rowCount: ROWS.length,
      truncated: false,
      executionTimeMs: 12,
      sql: SQL,
    },
  });

  // Persist artifacts so the artifact panel is populated in the demo too.
  await saveArtifact({ type: "sql", title: "SQL — malls per city", payload: { sql: SQL, purpose: "malls per city", executionTimeMs: 12 } });
  await saveArtifact({
    type: "table",
    title: "Result — malls per city",
    payload: { columns: [{ name: "city", type: "text" }, { name: "mall_count", type: "int8" }], rows: ROWS, rowCount: ROWS.length, truncated: false, sql: SQL },
  });
  await saveArtifact({
    type: "chartSpec",
    title: "Malls per city",
    payload: { type: "bar", title: "Malls per city", x: "city", y: "mall_count", sourceSql: SQL },
  });

  if (!(await cont(2))) return { finishReason: "abort", steps: 2, aborted: true };

  // Final answer
  await emit({ type: "text-start", id: "x1" });
  for (const piece of chunkText(ANSWER, 28)) {
    await emit({ type: "text-delta", id: "x1", delta: piece });
    await sleep(35);
  }
  await emit({ type: "text-end", id: "x1" });

  await emit({ type: "finish", finishReason: "stop" });

  return { finishReason: "stop", steps: 2, aborted: false };
}
