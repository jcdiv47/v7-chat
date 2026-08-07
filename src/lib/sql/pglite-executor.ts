/**
 * In-process pglite executor for offline development. Runs a real Postgres
 * engine (WASM) with the sample dataset seeded, so the TUI and evals work with
 * zero external setup. Node-only; pglite is a devDependency. Not used by the web
 * runtime (which requires a real INTERMEDIATE_DATABASE_URL).
 */
import type {
  DescribeTableOutput,
  RunSqlResult,
  TableInfo,
} from "../agent/types";
import { assertReadOnlySql, SqlGuardError } from "./guard";
import {
  capRows,
  describeTableSql,
  fieldsToColumns,
  loadExecutorConfig,
  LIST_TABLES_SQL,
  ROW_ESTIMATE_SQL,
  toConciseDbError,
  type ExecutorConfig,
  type PostgresExecutor,
} from "./executor";
import { seedStatements } from "./seed";

export async function createPgliteExecutor(
  cfgOverride?: Partial<ExecutorConfig>,
): Promise<PostgresExecutor> {
  const cfg: ExecutorConfig = { ...loadExecutorConfig(), ...cfgOverride };
  // Dynamic import so bundlers that can't handle the WASM asset never load it
  // unless this offline path is actually taken.
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  for (const stmt of seedStatements()) {
    await db.query(stmt);
  }

  return {
    async listTables(): Promise<TableInfo[]> {
      const res = await db.query<{ name: string; row_estimate: unknown }>(
        LIST_TABLES_SQL,
      );
      return res.rows.map((r) => ({
        name: String(r.name),
        rowEstimate: r.row_estimate != null ? Number(r.row_estimate) : undefined,
      }));
    },

    async describeTable(name: string): Promise<DescribeTableOutput> {
      const cols = await db.query<{ name: string; type: string; nullable: boolean }>(
        describeTableSql(),
        [name],
      );
      const est = await db.query<{ row_estimate: unknown }>(ROW_ESTIMATE_SQL, [name]);
      return {
        table: name,
        columns: cols.rows.map((r) => ({
          name: String(r.name),
          type: String(r.type),
          nullable: Boolean(r.nullable),
        })),
        rowEstimate:
          est.rows[0]?.row_estimate != null
            ? Number(est.rows[0].row_estimate)
            : undefined,
      };
    },

    async runSql(input): Promise<RunSqlResult> {
      const startedAt = Date.now();
      let safeSql: string;
      try {
        safeSql = assertReadOnlySql(input.sql);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof SqlGuardError ? err.message : toConciseDbError(err),
          sql: input.sql,
          executionTimeMs: Date.now() - startedAt,
        };
      }
      try {
        const res = await db.query<Record<string, unknown>>(safeSql);
        const { rows, truncated } = capRows(res.rows, cfg);
        return {
          ok: true,
          columns: fieldsToColumns(
            (res.fields ?? []) as Array<{ name: string; dataTypeID?: number }>,
          ),
          rows,
          rowCount: res.rows.length,
          truncated,
          executionTimeMs: Date.now() - startedAt,
          sql: safeSql,
        };
      } catch (err) {
        return {
          ok: false,
          error: toConciseDbError(err),
          sql: safeSql,
          executionTimeMs: Date.now() - startedAt,
        };
      }
    },

    async close() {
      await db.close();
    },
  };
}

/**
 * Pick the right executor for a Node process (TUI / evals): the real database
 * when the caller has an analytical database URL, otherwise the seeded offline
 * pglite DB.
 *
 * The URL is a parameter rather than a `process.env` read so that "unset means
 * pglite" is decided by the environment module — which has one definition of
 * empty, and declares the variable optional — instead of by a truthiness check
 * here. Callers pass `env.INTERMEDIATE_DATABASE_URL` straight through.
 */
export async function createNodeExecutor(options: {
  intermediateDatabaseUrl: string | undefined;
  config?: Partial<ExecutorConfig>;
}): Promise<{ executor: PostgresExecutor; kind: "postgres" | "pglite" }> {
  const { intermediateDatabaseUrl: url, config } = options;
  if (url !== undefined) {
    const { createPgExecutor } = await import("./pg-executor");
    return { executor: createPgExecutor(url, config), kind: "postgres" };
  }
  return { executor: await createPgliteExecutor(config), kind: "pglite" };
}
