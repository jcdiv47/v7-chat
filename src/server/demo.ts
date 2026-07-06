/**
 * Offline demo runner. When no model provider is configured (MODEL_PROVIDER=mock
 * or a missing OPENROUTER_API_KEY), the chat loop runs this deterministic script
 * instead of the real ToolLoopAgent. It emits the same UI message chunks — so
 * the streaming, resumability, folding UI, artifact panel, and persistence stack
 * are all exercised end-to-end without any external services. Clearly labeled as
 * a demo.
 */
import type { UIMessageChunk } from "ai";
import type { AgentToolDeps, AskUserInput } from "../lib/agent/types";
import type { ViewSpec } from "../lib/agent/ui-spec";

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

const QUESTION_REASONING =
  "This is the offline demo runner. The request looks ambiguous, so I'll ask " +
  "clarification questions (batched into one call) and stop — the answers " +
  "start the next run.";

const QUESTION_INPUT: AskUserInput = {
  questions: [
    {
      question: "Which timeframe should the analysis cover?",
      kind: "single",
      options: [
        { label: "Last 7 days", description: "Recent activity only" },
        { label: "Last 30 days", description: "A month of activity" },
        { label: "All time" },
      ],
    },
    {
      question: "Which cities should be included?",
      kind: "multi",
      options: [
        { label: "上海市" },
        { label: "北京市" },
        { label: "深圳市" },
        { label: "All cities" },
      ],
    },
  ],
};

/** Scripted askUser turn: the real HITL chunk sequence — the tool call gets
 * input but never an output, and the run finishes on "tool-calls" (the loop
 * stops at the question; see docs/specs/10). */
async function runDemoQuestion(
  emit: (c: UIMessageChunk) => Promise<void>,
  cont: (step: number) => Promise<boolean>,
): Promise<DemoResult> {
  await emit({ type: "start" });
  await emit({ type: "start-step" });
  if (!(await cont(0))) return { finishReason: "abort", steps: 0, aborted: true };

  await emit({ type: "reasoning-start", id: "r1" });
  for (const piece of chunkText(QUESTION_REASONING, 24)) {
    await emit({ type: "reasoning-delta", id: "r1", delta: piece });
    await sleep(40);
  }
  await emit({ type: "reasoning-end", id: "r1" });

  await emit({ type: "tool-input-start", toolCallId: "q1", toolName: "askUser" });
  for (const piece of chunkText(JSON.stringify(QUESTION_INPUT), 40)) {
    await emit({ type: "tool-input-delta", toolCallId: "q1", inputTextDelta: piece });
    await sleep(30);
  }
  await emit({
    type: "tool-input-available",
    toolCallId: "q1",
    toolName: "askUser",
    input: QUESTION_INPUT,
  });

  await emit({ type: "finish", finishReason: "tool-calls" });
  return { finishReason: "tool-calls", steps: 1, aborted: false };
}

export async function runDemoAnalysis(opts: {
  onChunk: (chunk: UIMessageChunk) => Promise<void> | void;
  saveArtifact: AgentToolDeps["saveArtifact"];
  beforeStep?: (stepNumber: number) => Promise<boolean> | boolean;
  /** The triggering user message text. The keyword "ambiguous" switches to the
   * scripted clarification-question turn. */
  userText?: string;
}): Promise<DemoResult> {
  const { onChunk, saveArtifact, beforeStep } = opts;
  const emit = async (c: UIMessageChunk) => {
    await onChunk(c);
  };

  const cont = async (step: number) => (beforeStep ? await beforeStep(step) : true);

  if (opts.userText && /ambiguous/i.test(opts.userText)) {
    return runDemoQuestion(emit, cont);
  }

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

  // Persist artifacts (as the real runSql deps do, before the output chunk) so
  // the artifact panel is populated and the output can carry a real resultId.
  await saveArtifact({ type: "sql", title: "SQL — malls per city", payload: { sql: SQL, purpose: "malls per city", executionTimeMs: 12 } });
  const { id: resultId } = await saveArtifact({
    type: "table",
    title: "Result — malls per city",
    payload: { columns: [{ name: "city", type: "text" }, { name: "mall_count", type: "int8" }], rows: ROWS, rowCount: ROWS.length, truncated: false, sql: SQL },
  });

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
      resultId,
    },
  });

  if (!(await cont(2))) return { finishReason: "abort", steps: 2, aborted: true };

  // Tool: presentData — the full chunk sequence, so demo mode exercises the
  // inline-view path (docs/specs/08 → Parallel Runtimes).
  const viewInput = { title: "Malls per city", type: "bar", x: "city", y: "mall_count", sort: "desc", resultId };
  const view: ViewSpec = {
    type: "bar",
    x: { column: "city" },
    y: { column: "mall_count" },
    sort: "desc",
  };
  await emit({ type: "tool-input-start", toolCallId: "t3", toolName: "presentData" });
  for (const piece of chunkText(JSON.stringify(viewInput), 40)) {
    await emit({ type: "tool-input-delta", toolCallId: "t3", inputTextDelta: piece });
    await sleep(30);
  }
  await emit({
    type: "tool-input-available",
    toolCallId: "t3",
    toolName: "presentData",
    input: viewInput,
  });
  const { id: viewId } = await saveArtifact({
    type: "view",
    title: "Malls per city",
    payload: { view, resultId, title: "Malls per city" },
  });
  await emit({
    type: "tool-output-available",
    toolCallId: "t3",
    output: { ok: true, viewId, resultId, view },
  });

  if (!(await cont(3))) return { finishReason: "abort", steps: 3, aborted: true };

  // Final answer
  await emit({ type: "text-start", id: "x1" });
  for (const piece of chunkText(ANSWER, 28)) {
    await emit({ type: "text-delta", id: "x1", delta: piece });
    await sleep(35);
  }
  await emit({ type: "text-end", id: "x1" });

  await emit({ type: "finish", finishReason: "stop" });

  return { finishReason: "stop", steps: 3, aborted: false };
}
