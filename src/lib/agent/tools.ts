/**
 * Agent tool definitions. Identical across the web runtime and the TUI — only
 * the {@link AgentToolDeps} implementation differs (Convex actions/mutations vs.
 * direct Postgres + console). Credentials never appear here; they live in the
 * server-side deps. See docs/specs/02-agent-runtime.md → Tools.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AgentToolDeps, ArtifactType } from "./types";

export const ARTIFACT_TYPES = [
  "sql",
  "table",
  "chartSpec",
  "finding",
  "error",
] as const satisfies readonly ArtifactType[];

export function createAgentTools(deps: AgentToolDeps): ToolSet {
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
      execute: async ({ sql, purpose }) => deps.runSql({ sql, purpose }),
    }),

    saveArtifact: tool({
      description:
        "Save an analysis artifact so the user can inspect it. Use type 'chartSpec' " +
        "for a chart (payload: {type,title,x,y,sourceSql}), 'finding' for a key " +
        "result, or 'error' to record a failure. SQL and result tables from runSql " +
        "are saved automatically, so you do not need to save those yourself.",
      inputSchema: z.object({
        type: z.enum(ARTIFACT_TYPES),
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
  "saveArtifact",
] as const;
