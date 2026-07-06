/**
 * TUI entrypoint — a fast local loop for testing the *same* agent definition the
 * web app uses (docs/specs/01 → Local TUI Flow). It wires the shared runner to a
 * Node Postgres executor (real INTERMEDIATE_DATABASE_URL, or a seeded in-process
 * pglite database) and disk-loaded skills, and prints reasoning / tool activity /
 * answers to the terminal.
 *
 *   npm run tui
 *
 * Set OPENROUTER_API_KEY (and optionally INTERMEDIATE_DATABASE_URL) in .env.local
 * or the environment. Without a DB, it falls back to the offline pglite sample
 * data. Slash commands: \tables  \describe <t>  \sql <query>  \skills  \quit
 */
import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { UIMessageChunk } from "ai";
import { runAnalysisAgent } from "../src/lib/agent/run";
import { buildInstructions } from "../src/lib/agent/instructions";
import { createAgentTools } from "../src/lib/agent/tools";
import { buildModelMessages, type CompactTurn } from "../src/lib/agent/history";
import { toolLabel, type RenderToolPart } from "../src/lib/agent/stream-parts";
import { createDiskSkillSource } from "../src/lib/skills/disk";
import { createNodeExecutor } from "../src/lib/sql/pglite-executor";
import { getModel, hasRealModel, resolveModelDef } from "../src/lib/models/registry";
import type {
  AgentToolDeps,
  AnalysisRuntimeContext,
  AskUserAnswer,
  AskUserInput,
} from "../src/lib/agent/types";
import type { PostgresExecutor } from "../src/lib/sql/executor";
import type { SkillSource } from "../src/lib/skills/types";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

function loadEnv() {
  try {
    // Node 20.12+/22 built-in .env loader.
    (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(".env.local");
  } catch {
    // No .env.local; rely on the ambient environment.
  }
}

/** Inline readline prompt for the askUser tool: pick options by number,
 * anything non-numeric is the free-text "Other" reply. Unlike the web runtime
 * (no execute — the run ends at the question), the TUI answers within the
 * same run. */
async function promptAskUser(rl: Interface, input: AskUserInput): Promise<AskUserAnswer> {
  stdout.write(`\n${C.bold}? ${input.question}${C.reset}\n`);
  input.options.forEach((opt, i) => {
    stdout.write(
      `  ${i + 1}. ${opt.label}${opt.description ? ` ${C.gray}— ${opt.description}${C.reset}` : ""}\n`,
    );
  });
  const hint =
    input.kind === "multi" ? "numbers (e.g. 1,3) and/or free text" : "a number or free text";
  for (;;) {
    const raw = (await rl.question(`${C.cyan}answer (${hint}) ›${C.reset} `)).trim();
    if (!raw) continue;
    const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
    const selected: string[] = [];
    const otherPieces: string[] = [];
    for (const token of tokens) {
      const n = Number(token);
      if (Number.isInteger(n) && n >= 1 && n <= input.options.length) {
        const label = input.options[n - 1].label;
        if (!selected.includes(label)) selected.push(label);
      } else {
        otherPieces.push(token);
      }
    }
    if (input.kind === "single" && selected.length > 1) {
      stdout.write(`${C.yellow}  pick one option${C.reset}\n`);
      continue;
    }
    const otherText = otherPieces.join(", ") || undefined;
    if (selected.length === 0 && !otherText) continue;
    return { answered: true, selected, otherText };
  }
}

function createTuiDeps(
  executor: PostgresExecutor,
  skills: SkillSource,
  rl: Interface,
): AgentToolDeps {
  // Local result registry: runtime-local ids (r1, r2, …) instead of artifact
  // rows, so presentData works without a database.
  const results = new Map<string, { columns: string[]; rowCount: number }>();
  return {
    listTables: () => executor.listTables(),
    describeTable: (t) => executor.describeTable(t),
    async runSql(input) {
      const result = await executor.runSql(input);
      if (!result.ok) return result;
      const resultId = `r${results.size + 1}`;
      results.set(resultId, {
        columns: result.columns.map((c) => c.name),
        rowCount: result.rowCount,
      });
      return { ...result, resultId };
    },
    async getResultMeta(resultId) {
      return results.get(resultId) ?? null;
    },
    async loadSkill(name) {
      const skill = skills.load(name);
      if (!skill) {
        return {
          skillDirectory: "",
          content: `Skill "${name}" not found. Available: ${skills
            .list()
            .map((s) => s.name)
            .join(", ")}`,
        };
      }
      return { skillDirectory: skill.directory, content: skill.content };
    },
    async saveArtifact({ type, title }) {
      stdout.write(`${C.gray}   ⛁ saved ${type} artifact: ${title}${C.reset}\n`);
      return { id: `tui-${Date.now()}` };
    },
    askUser: (input) => promptAskUser(rl, input),
  };
}

/** Print a compact one-line tool summary for a finished tool call. */
function summarizeTool(part: RenderToolPart): string {
  if (part.name === "runSql") {
    const output = (part.output ?? {}) as { rowCount?: number; ok?: boolean; error?: string; resultId?: string };
    if (output.ok === false) return `runSql failed: ${output.error ?? "error"}`;
    return `runSql → ${output.rowCount ?? 0} row(s)${output.resultId ? ` (${output.resultId})` : ""}`;
  }
  if (part.name === "presentData") {
    const output = (part.output ?? {}) as { ok?: boolean; error?: string; view?: { type?: string } };
    const title = (part.input as { title?: string } | undefined)?.title ?? "";
    if (output.ok !== true) return `presentData failed: ${output.error ?? "error"}`;
    return `[view: ${output.view?.type} "${title}"]`;
  }
  if (part.name === "askUser") {
    const input = (part.input ?? {}) as Partial<AskUserInput>;
    const output = (part.output ?? {}) as Partial<AskUserAnswer>;
    const answer = [
      output.selected?.length ? output.selected.join(", ") : "",
      output.otherText ? `Other: ${output.otherText}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    return `askUser "${input.question ?? ""}" → ${answer || "(no answer)"}`;
  }
  return toolLabel(part);
}

async function main() {
  loadEnv();
  const skills = createDiskSkillSource("agent-skills");
  const { executor, kind } = await createNodeExecutor();

  stdout.write(`${C.bold}v7 Business Analyst — TUI${C.reset}\n`);
  stdout.write(
    `${C.gray}skills ${skills.version} • db: ${kind} • model: ${
      hasRealModel() ? resolveModelDef("analyst").modelId : "none (set OPENROUTER_API_KEY)"
    }${C.reset}\n`,
  );
  stdout.write(
    `${C.gray}Ask a question, or: \\tables  \\describe <t>  \\sql <query>  \\skills  \\quit${C.reset}\n\n`,
  );

  const rl = createInterface({ input: stdin, output: stdout });
  const deps = createTuiDeps(executor, skills, rl);
  const instructions = buildInstructions(skills.list());
  const history: CompactTurn[] = [];

  for (;;) {
    const line = (await rl.question(`${C.cyan}you ›${C.reset} `)).trim();
    if (!line) continue;

    if (line === "\\quit" || line === "\\q" || line === "\\exit") break;
    if (line === "\\skills") {
      for (const s of skills.list()) stdout.write(`  ${C.bold}${s.name}${C.reset} — ${s.description}\n`);
      stdout.write("\n");
      continue;
    }
    if (line === "\\tables") {
      const tables = await executor.listTables();
      for (const t of tables) stdout.write(`  ${t.name}${t.rowEstimate != null ? ` (~${t.rowEstimate} rows)` : ""}\n`);
      stdout.write("\n");
      continue;
    }
    if (line.startsWith("\\describe ")) {
      const table = line.slice("\\describe ".length).trim();
      const info = await executor.describeTable(table);
      for (const c of info.columns) stdout.write(`  ${c.name} ${C.gray}${c.type}${c.nullable ? " null" : ""}${C.reset}\n`);
      stdout.write("\n");
      continue;
    }
    if (line.startsWith("\\sql ")) {
      const sql = line.slice("\\sql ".length).trim();
      const res = await executor.runSql({ sql });
      if (res.ok) {
        stdout.write(`${C.green}  ${res.rowCount} row(s) in ${res.executionTimeMs}ms${C.reset}\n`);
        stdout.write(`  ${res.columns.map((c) => c.name).join(" | ")}\n`);
        for (const row of res.rows.slice(0, 20)) {
          stdout.write(`  ${res.columns.map((c) => String(row[c.name] ?? "")).join(" | ")}\n`);
        }
      } else {
        stdout.write(`${C.red}  error: ${res.error}${C.reset}\n`);
      }
      stdout.write("\n");
      continue;
    }

    if (!hasRealModel()) {
      stdout.write(
        `${C.yellow}No model provider configured. Set OPENROUTER_API_KEY in .env.local to ask the agent.\n` +
          `Meanwhile, \\tables, \\describe, and \\sql work against the ${kind} database.${C.reset}\n\n`,
      );
      continue;
    }

    history.push({ role: "user", text: line });

    // Per turn, not per session: createAgentTools tracks the turn's resultIds
    // in a closure for presentData's sole-result fallback. deps stay
    // session-scoped so getResultMeta still resolves earlier turns' ids.
    const tools = createAgentTools(deps);

    const collectedText: string[] = [];
    const toolParts = new Map<string, RenderToolPart>();
    let reasoningOpen = false;
    let answerOpen = false;

    const onChunk = (chunk: UIMessageChunk) => {
      switch (chunk.type) {
        case "reasoning-start":
          if (!reasoningOpen) {
            stdout.write(`${C.gray}${C.dim}thinking… `);
            reasoningOpen = true;
          }
          break;
        case "reasoning-delta":
          stdout.write(`${C.gray}${C.dim}${chunk.delta}${C.reset}`);
          break;
        case "reasoning-end":
          if (reasoningOpen) stdout.write(`${C.reset}\n`);
          reasoningOpen = false;
          break;
        case "tool-input-available": {
          const part: RenderToolPart = {
            kind: "tool",
            toolCallId: chunk.toolCallId,
            name: chunk.toolName,
            input: chunk.input,
            status: "running",
          };
          toolParts.set(chunk.toolCallId, part);
          stdout.write(`${C.yellow}  🔧 ${toolLabel(part)}${C.reset}\n`);
          break;
        }
        case "tool-output-available": {
          const part = toolParts.get(chunk.toolCallId);
          if (part) {
            part.status = "done";
            part.output = chunk.output;
            stdout.write(`${C.green}     ✓ ${summarizeTool(part)}${C.reset}\n`);
          }
          break;
        }
        case "tool-output-error": {
          const part = toolParts.get(chunk.toolCallId);
          if (part) {
            part.status = "error";
            stdout.write(`${C.red}     ✗ ${chunk.errorText}${C.reset}\n`);
          }
          break;
        }
        case "text-start":
          if (!answerOpen) {
            stdout.write(`\n${C.bold}analyst ›${C.reset} `);
            answerOpen = true;
          }
          break;
        case "text-delta":
          collectedText.push(chunk.delta);
          stdout.write(chunk.delta);
          break;
        case "error":
          stdout.write(`\n${C.red}error: ${chunk.errorText}${C.reset}\n`);
          break;
        default:
          break;
      }
    };

    const alias = "analyst" as const;
    const def = resolveModelDef(alias);
    const runtimeContext: AnalysisRuntimeContext = {
      requestId: `tui-${Date.now()}`,
      runId: `tui-${Date.now()}`,
      threadId: "tui",
      userId: "tui",
      modelAlias: alias,
      activeSkillNames: skills.list().map((s) => s.name),
      loadedSkillNames: [],
      skillsVersion: skills.version,
    };

    try {
      const result = await runAnalysisAgent({
        model: getModel(alias),
        temperature: def.temperature,
        maxOutputTokens: def.maxOutputTokens,
        reasoning: def.reasoning,
        instructions,
        messages: buildModelMessages(history),
        tools,
        maxSteps: 12,
        runtimeContext,
        onChunk,
      });
      const answer = collectedText.join("").trim();
      const toolLines = [...toolParts.values()].map((p) => summarizeTool(p));
      history.push({ role: "assistant", text: answer, toolLines });
      if (result.errorText) stdout.write(`\n${C.red}(run error: ${result.errorText})${C.reset}`);
      stdout.write(`\n${C.gray}— ${result.steps} step(s)${C.reset}\n\n`);
    } catch (err) {
      // Drop the user turn that got no assistant reply, so the next question
      // doesn't send two consecutive user messages (some providers reject that).
      history.pop();
      stdout.write(`\n${C.red}Failed: ${err instanceof Error ? err.message : String(err)}${C.reset}\n\n`);
    }
  }

  rl.close();
  await executor.close();
  stdout.write("bye\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
