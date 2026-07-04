/**
 * Web runtime implementation of the agent tool deps. Postgres runs via
 * `"use node"` internal actions; artifacts and events are written through Convex
 * mutations. Credentials never appear here. See docs/specs/02 → Tool Context.
 */
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { AgentToolDeps } from "../../src/lib/agent/types";
import { bundledSkillSource } from "../../src/lib/skills/loader";

export type RunStats = {
  sqlCount: number;
  toolCallCount: number;
  artifactCount: number;
  loadedSkills: Set<string>;
};

export function newRunStats(): RunStats {
  return { sqlCount: 0, toolCallCount: 0, artifactCount: 0, loadedSkills: new Set() };
}

export function createWebDeps(
  ctx: ActionCtx,
  opts: { runId: Id<"runs">; threadId: Id<"threads">; stats: RunStats },
): AgentToolDeps {
  const { runId, threadId, stats } = opts;

  return {
    async listTables() {
      return await ctx.runAction(internal.node.postgres.listTables, {});
    },

    async describeTable(table: string) {
      return await ctx.runAction(internal.node.postgres.describeTable, { table });
    },

    async runSql({ sql, purpose }) {
      stats.sqlCount += 1;
      const result = await ctx.runAction(internal.node.postgres.runSql, { sql, purpose });

      await ctx.runMutation(internal.events.append, {
        runId,
        threadId,
        type: "sql.executed",
        metadata: {
          sql: result.sql,
          ok: result.ok,
          purpose,
          rowCount: result.ok ? result.rowCount : 0,
          truncated: result.ok ? result.truncated : false,
          executionTimeMs: result.executionTimeMs,
          error: result.ok ? undefined : result.error,
        },
      });

      if (result.ok) {
        // Full preview (up to maxRows) lives in the artifact; the stream carries
        // only a ~20-row preview (trimmed at serialization time).
        await ctx.runMutation(internal.artifacts.save, {
          runId,
          threadId,
          type: "sql",
          title: purpose ? `SQL — ${purpose}` : "SQL query",
          payload: { sql: result.sql, purpose, executionTimeMs: result.executionTimeMs },
        });
        await ctx.runMutation(internal.artifacts.save, {
          runId,
          threadId,
          type: "table",
          title: purpose ? `Result — ${purpose}` : "Query result",
          payload: {
            columns: result.columns,
            rows: result.rows,
            rowCount: result.rowCount,
            truncated: result.truncated,
            executionTimeMs: result.executionTimeMs,
            sql: result.sql,
          },
        });
      } else {
        await ctx.runMutation(internal.artifacts.save, {
          runId,
          threadId,
          type: "error",
          title: "SQL error",
          payload: { sql: result.sql, error: result.error },
        });
      }

      return result;
    },

    async loadSkill(name: string) {
      const skill = bundledSkillSource.load(name);
      if (!skill) {
        const available = bundledSkillSource.list().map((s) => s.name).join(", ");
        return {
          skillDirectory: "",
          content: `Skill "${name}" was not found. Available skills: ${available}.`,
        };
      }
      stats.loadedSkills.add(name);
      return { skillDirectory: skill.directory, content: skill.content };
    },

    async saveArtifact({ type, title, payload }) {
      stats.artifactCount += 1;
      const id = await ctx.runMutation(internal.artifacts.save, {
        runId,
        threadId,
        type,
        title,
        payload,
      });
      await ctx.runMutation(internal.events.append, {
        runId,
        threadId,
        type: "artifact.saved",
        metadata: { artifactType: type, title },
      });
      return { id };
    },
  };
}
