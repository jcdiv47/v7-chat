/**
 * Agent tool definitions. Identical across the web runtime and the TUI — only
 * the {@link AgentToolDeps} implementation differs (Drizzle-backed server deps
 * vs. direct Postgres + console). Credentials never appear here; they live in the
 * server-side deps. See docs/specs/02-agent-runtime.md → Tools.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AgentToolDeps, ArtifactType, AskUserInput } from "./types";
import {
  formatViewSpecError,
  normalizeViewInput,
  presentDataInput,
  referencedColumns,
  viewSpec,
  type PresentDataOutput,
} from "./ui-spec";

export const ARTIFACT_TYPES = [
  "sql",
  "table",
  "chartSpec",
  "view",
  "finding",
  "error",
] as const satisfies readonly ArtifactType[];

/** Types the model may save directly; sql/table are auto-saved by runSql and
 * view by presentData. (chartSpec is legacy — superseded by presentData.) */
const SAVEABLE_ARTIFACT_TYPES = ["finding", "error"] as const;

const ASK_USER_TOOL_CONFIG = {
  description:
    "Ask the user clarification questions when the request is genuinely " +
    "ambiguous and the answers change what you'd do. Batch every " +
    "clarification you need into ONE call (up to 3 questions). Prefer asking " +
    "before running queries, not after. Do not call any other tool in the " +
    "same step.",
  inputSchema: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().describe("One clarification question."),
          kind: z.enum(["single", "multi"]),
          options: z
            .array(
              z.object({
                label: z.string(),
                description: z.string().optional(),
              }),
            )
            .min(2)
            .max(5),
        }),
      )
      .min(1)
      .max(3),
  }),
};

export function createAgentTools(deps: AgentToolDeps): ToolSet {
  // resultIds produced by this turn's runSql calls, powering presentData's
  // sole-result fallback and its "available ids" error messages.
  const turnResultIds: string[] = [];

  return {
    loadSkill: tool({
      description:
        "Load a domain skill by name and return its full instructions. Call this " +
        "before acting when a listed skill is relevant (domain questions, charts, " +
        "explaining results, or query conventions before writing SQL).",
      inputSchema: z.object({
        name: z.string().describe("The exact skill name from the Available skills list."),
      }),
      execute: async ({ name }) => deps.loadSkill(name),
    }),

    listTables: tool({
      description:
        "List the tables available in the read-only analytical database, with row " +
        "count estimates.",
      inputSchema: z.object({}),
      execute: async () => ({ tables: await deps.listTables() }),
    }),

    describeTable: tool({
      description:
        "Describe one table: its columns, types, nullability, and estimated row " +
        "count. Inspect a table before relying on its column names.",
      inputSchema: z.object({
        table: z.string().describe("The table name, e.g. cities, malls, or stores."),
      }),
      execute: async ({ table }) => deps.describeTable(table),
    }),

    runSql: tool({
      description:
        "Execute a single read-only SQL query (SELECT / WITH only) against the " +
        "analytical database and return columns, rows, and metadata. Writes and " +
        "DDL are rejected. Results are capped by row count and a statement timeout.",
      inputSchema: z.object({
        sql: z.string().describe("A single read-only SELECT/WITH statement."),
        purpose: z
          .string()
          .optional()
          .describe("A short note on what this query is meant to answer."),
      }),
      execute: async ({ sql, purpose }) => {
        const result = await deps.runSql({ sql, purpose });
        if (result.ok && result.resultId) turnResultIds.push(result.resultId);
        return result;
      },
    }),

    presentData: tool({
      description:
        "Present a query result as an inline view for the user: a table, bar or " +
        "line chart, scatter plot, or single-stat callout. Reference the result " +
        "by the resultId returned from runSql; never re-type rows. Call this " +
        "after the result exists and before writing your final answer.",
      inputSchema: presentDataInput,
      execute: async (input): Promise<PresentDataOutput> => {
        const parsed = viewSpec.safeParse(normalizeViewInput(input));
        if (!parsed.success) {
          return { ok: false, error: formatViewSpecError(input.type, parsed.error) };
        }
        const view = parsed.data;

        let resultId = input.resultId;
        if (!resultId) {
          if (turnResultIds.length === 1) {
            resultId = turnResultIds[0];
          } else if (turnResultIds.length === 0) {
            return { ok: false, error: "No query result to present — run SQL first." };
          } else {
            return {
              ok: false,
              error: `Multiple results this turn — pass resultId (one of: ${turnResultIds.join(", ")}).`,
            };
          }
        }

        const meta = await deps.getResultMeta(resultId);
        if (!meta) {
          const known = turnResultIds.length
            ? ` Known ids this turn: ${turnResultIds.join(", ")}.`
            : "";
          return { ok: false, error: `Unknown resultId '${resultId}'.${known}` };
        }

        const missing = referencedColumns(view).filter(
          (c) => !meta.columns.includes(c),
        );
        if (missing.length > 0) {
          return {
            ok: false,
            error: `column '${missing[0]}' not in result (has: ${meta.columns.join(", ")})`,
          };
        }

        const { id: viewId } = await deps.saveArtifact({
          type: "view",
          title: input.title,
          payload: { view, resultId, title: input.title },
        });
        return { ok: true, viewId, resultId, view };
      },
    }),

    // Without an askUser dep there is deliberately no execute: the tool loop
    // stops at the question and the user's answer starts the next run.
    askUser: deps.askUser
      ? tool({
          ...ASK_USER_TOOL_CONFIG,
          execute: async (input: AskUserInput) => deps.askUser!(input),
        })
      : tool(ASK_USER_TOOL_CONFIG),

    saveArtifact: tool({
      description:
        "Save an analysis artifact so the user can inspect it. Use type 'finding' " +
        "for a key result, or 'error' to record a failure. SQL and result tables " +
        "from runSql are saved automatically, and views are saved by presentData, " +
        "so you do not need to save those yourself.",
      inputSchema: z.object({
        type: z.enum(SAVEABLE_ARTIFACT_TYPES),
        title: z.string(),
        payload: z
          .record(z.string(), z.any())
          .optional()
          .describe("Artifact contents as a JSON object; shape depends on type."),
      }),
      execute: async ({ type, title, payload }) =>
        deps.saveArtifact({ type, title, payload: payload ?? {} }),
    }),
  } satisfies ToolSet;
}

/** Tool names the agent exposes, for logging / activeTools configuration. */
export const AGENT_TOOL_NAMES = [
  "loadSkill",
  "listTables",
  "describeTable",
  "runSql",
  "presentData",
  "askUser",
  "saveArtifact",
] as const;
