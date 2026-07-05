/**
 * Worker implementation of the agent tool deps. Postgres runs via the plain
 * pg executor (the old `"use node"` action boundary is gone); artifacts and
 * events are written straight through Drizzle. Credentials never appear here.
 * See docs/specs/02 → Tool Context.
 */
import { and, eq } from "drizzle-orm";
import type { AgentToolDeps, SqlColumn } from "../lib/agent/types";
import { createPgExecutor } from "../lib/sql/pg-executor";
import type { PostgresExecutor } from "../lib/sql/executor";
import { bundledSkillSource } from "../lib/skills/loader";
import { getDb } from "./db/client";
import { artifacts } from "./db/schema";
import { appendEvent, heartbeat, saveArtifact } from "./runs-service";

export type RunStats = {
  sqlCount: number;
  toolCallCount: number;
  artifactCount: number;
  loadedSkills: Set<string>;
};

export function newRunStats(): RunStats {
  return { sqlCount: 0, toolCallCount: 0, artifactCount: 0, loadedSkills: new Set() };
}

let _executor: PostgresExecutor | null = null;

function executor(): PostgresExecutor {
  if (_executor) return _executor;
  const url = process.env.INTERMEDIATE_DATABASE_URL;
  if (!url) {
    throw new Error(
      "INTERMEDIATE_DATABASE_URL is not set. Point it at the read-only " +
        "analytical Postgres (see .env.example).",
    );
  }
  _executor = createPgExecutor(url);
  return _executor;
}

export function createWorkerDeps(opts: {
  runId: string;
  threadId: string;
  stats: RunStats;
}): AgentToolDeps {
  const { runId, threadId, stats } = opts;
  const db = getDb();

  // Mid-step fence: stamps the heartbeat (so one long tool step doesn't read as
  // stale) and aborts the tool if the run was stopped or reclaimed — a dead
  // executor must not keep writing artifacts/events alongside a newer run.
  const assertLive = async () => {
    const hb = await heartbeat(runId);
    if (hb.stop) {
      throw new Error("Run is no longer live (stopped or reclaimed).");
    }
  };

  return {
    async listTables() {
      await assertLive();
      return await executor().listTables();
    },

    async describeTable(table: string) {
      await assertLive();
      return await executor().describeTable(table);
    },

    async runSql({ sql, purpose }) {
      await assertLive();
      stats.sqlCount += 1;
      const result = await executor().runSql({ sql, purpose });

      await appendEvent(db, {
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
        await saveArtifact(db, {
          runId,
          threadId,
          type: "sql",
          title: purpose ? `SQL — ${purpose}` : "SQL query",
          payload: { sql: result.sql, purpose, executionTimeMs: result.executionTimeMs },
        });
        const resultId = await saveArtifact(db, {
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
        // The model echoes this id into presentData to reference the result.
        return { ...result, resultId };
      } else {
        await saveArtifact(db, {
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

    async getResultMeta(resultId) {
      // Thread-scoped (not run-scoped) so a follow-up turn can re-present an
      // earlier turn's result without re-running SQL.
      const row = await db.query.artifacts.findFirst({
        columns: { payload: true },
        where: and(
          eq(artifacts.id, resultId),
          eq(artifacts.threadId, threadId),
          eq(artifacts.type, "table"),
        ),
      });
      if (!row) return null;
      const payload = row.payload as { columns?: SqlColumn[]; rowCount?: number };
      return {
        columns: (payload.columns ?? []).map((c) => c.name),
        rowCount: payload.rowCount ?? 0,
      };
    },

    async saveArtifact({ type, title, payload }) {
      await assertLive();
      stats.artifactCount += 1;
      const id = await saveArtifact(db, { runId, threadId, type, title, payload });
      await appendEvent(db, {
        runId,
        threadId,
        type: "artifact.saved",
        metadata: { artifactType: type, title },
      });
      return { id };
    },
  };
}
