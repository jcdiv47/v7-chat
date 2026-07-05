/**
 * Eval runner (docs/specs/06). With a model configured, runs each prompt through
 * the real agent against the seeded pglite database and scores it with the
 * spec's rubric heuristics. Without a model, it validates the canonical SQL
 * against the data as an offline data-layer check.
 *
 *   npm run eval           # all prompts
 *   npm run eval -- 5      # first 5 prompts
 *
 * Note: with a real OPENROUTER_API_KEY this makes model calls (uses credits).
 */
import type { UIMessageChunk } from "ai";
import { EVAL_PROMPTS, type EvalPrompt } from "./prompts";
import { runAnalysisAgent } from "../src/lib/agent/run";
import { buildInstructions } from "../src/lib/agent/instructions";
import { createAgentTools } from "../src/lib/agent/tools";
import { createDiskSkillSource } from "../src/lib/skills/disk";
import { createNodeExecutor } from "../src/lib/sql/pglite-executor";
import { getModel, hasRealModel, resolveModelDef } from "../src/lib/models/registry";
import type { AgentToolDeps, AnalysisRuntimeContext } from "../src/lib/agent/types";
import type { PostgresExecutor } from "../src/lib/sql/executor";

const C = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", gray: "\x1b[90m", bold: "\x1b[1m" };

function loadEnv() {
  try {
    (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(".env.local");
  } catch {
    /* ambient env */
  }
}

type Capture = {
  sql: string[];
  chartSaved: boolean;
  answer: string;
};

function evalDeps(executor: PostgresExecutor, skills: ReturnType<typeof createDiskSkillSource>, cap: Capture): AgentToolDeps {
  const results = new Map<string, { columns: string[]; rowCount: number }>();
  return {
    listTables: () => executor.listTables(),
    describeTable: (t) => executor.describeTable(t),
    async runSql(input) {
      cap.sql.push(input.sql);
      const result = await executor.runSql(input);
      if (!result.ok) return result;
      const resultId = `r${results.size + 1}`;
      results.set(resultId, { columns: result.columns.map((c) => c.name), rowCount: result.rowCount });
      return { ...result, resultId };
    },
    async getResultMeta(resultId) {
      return results.get(resultId) ?? null;
    },
    async loadSkill(name) {
      const s = skills.load(name);
      return s ? { skillDirectory: s.directory, content: s.content } : { skillDirectory: "", content: "not found" };
    },
    async saveArtifact({ type }) {
      // A saved view is a successful presentData call (the tool validates
      // before saving); chartSpec covers a model still on the legacy path.
      if (type === "view" || type === "chartSpec") cap.chartSaved = true;
      return { id: "eval" };
    },
  };
}

/** Rubric heuristics from docs/specs/06 → Eval Scoring. */
function score(p: EvalPrompt, cap: Capture): { pass: boolean; note: string } {
  const answer = cap.answer.toLowerCase();
  const ranSql = cap.sql.length > 0;
  if (p.category === "unavailable") {
    const acknowledges = /(no|not|n't|without|unavailable|missing|doesn'?t|isn'?t|don'?t)\b[\s\S]{0,40}(revenue|traffic|growth|time|quarter|sales|data|column)/.test(answer);
    return { pass: acknowledges, note: acknowledges ? "acknowledges missing data" : "did not clearly state data is unavailable" };
  }
  if (p.category === "ambiguity") {
    const hedges = /(ambig|assum|proxy|clarif|depend|interpret|not clear|no.*metric)/.test(answer);
    return { pass: hedges && ranSql, note: hedges ? "notes ambiguity" : "did not flag ambiguity" };
  }
  if (p.category === "chart") {
    return { pass: cap.chartSaved && ranSql, note: cap.chartSaved ? "chart spec saved" : "no chart spec saved" };
  }
  return { pass: ranSql && cap.answer.trim().length > 0, note: ranSql ? "grounded in SQL" : "no SQL run" };
}

async function runOffline(executor: PostgresExecutor) {
  console.log(`${C.yellow}No model configured — running the offline data-layer check.${C.reset}`);
  console.log(`${C.gray}Set OPENROUTER_API_KEY to run the full agent eval.${C.reset}\n`);
  const checks: Array<[string, string, number]> = [
    ["cities", "select count(*) n from aiqa.cities", 6],
    ["malls", "select count(*) n from aiqa.malls", 9],
    ["stores", "select count(*) n from aiqa.stores", 26],
    ["empty malls", "select count(*) n from aiqa.malls m left join aiqa.stores s on s.mall_id=m.id where s.id is null", 1],
    ["mall-less cities", "select count(*) n from aiqa.cities c left join aiqa.malls m on m.city=c.city where m.id is null", 1],
  ];
  let ok = 0;
  for (const [label, sql, expected] of checks) {
    const res = await executor.runSql({ sql });
    const n = res.ok ? Number((res.rows[0] as { n: unknown }).n) : NaN;
    const pass = n === expected;
    if (pass) ok++;
    console.log(`  ${pass ? C.green + "PASS" : C.red + "FAIL"}${C.reset} ${label}: ${n} (expected ${expected})`);
  }
  console.log(`\n${ok}/${checks.length} data checks passed.`);
}

async function main() {
  loadEnv();
  const limit = Number(process.argv[2]) || EVAL_PROMPTS.length;
  const prompts = EVAL_PROMPTS.slice(0, limit);
  const skills = createDiskSkillSource("agent-skills");
  const { executor, kind } = await createNodeExecutor();

  if (!hasRealModel()) {
    await runOffline(executor);
    await executor.close();
    return;
  }

  const def = resolveModelDef("analyst");
  console.log(`${C.bold}Running ${prompts.length} eval prompt(s)${C.reset} ${C.gray}(model ${def.modelId}, db ${kind})${C.reset}\n`);

  const results: Array<{ p: EvalPrompt; pass: boolean; note: string; cap: Capture }> = [];
  for (const p of prompts) {
    const cap: Capture = { sql: [], chartSaved: false, answer: "" };
    const deps = evalDeps(executor, skills, cap);
    const tools = createAgentTools(deps);
    const textParts: string[] = [];
    const rc: AnalysisRuntimeContext = { requestId: "eval", runId: "eval", threadId: "eval", userId: "eval", modelAlias: "analyst", activeSkillNames: skills.list().map((s) => s.name), loadedSkillNames: [], skillsVersion: skills.version };
    const onChunk = (c: UIMessageChunk) => {
      if (c.type === "text-delta") textParts.push(c.delta);
    };
    try {
      await runAnalysisAgent({ model: getModel("analyst"), temperature: def.temperature, maxOutputTokens: def.maxOutputTokens, reasoning: def.reasoning, instructions: buildInstructions(skills.list()), messages: [{ role: "user", content: p.prompt }], tools, maxSteps: 12, runtimeContext: rc, onChunk });
      cap.answer = textParts.join("");
    } catch (err) {
      cap.answer = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
    const s = score(p, cap);
    results.push({ p, pass: s.pass, note: s.note, cap });
    const mark = s.pass ? `${C.green}PASS${C.reset}` : `${C.red}CHECK${C.reset}`;
    console.log(`${mark} ${C.gray}[${p.category}]${C.reset} ${p.prompt}`);
    console.log(`     ${C.gray}${s.note} · ${cap.sql.length} query(s) · ${cap.answer.replace(/\s+/g, " ").slice(0, 80)}${C.reset}`);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${C.bold}${passed}/${results.length} passed the rubric heuristics.${C.reset}`);
  console.log(`${C.gray}CHECK rows are for manual review, not necessarily failures.${C.reset}`);
  await executor.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
