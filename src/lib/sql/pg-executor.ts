/**
 * `pg`-backed executor for the real intermediate Postgres database. Node-only:
 * imported by the Convex `"use node"` action and by the TUI when
 * INTERMEDIATE_DATABASE_URL is set. Never import this from a V8 Convex module.
 */
import { Client } from "pg";
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

const POSTGRES_DATE_OID = 1082;

function normalizePgValueForConvex(value: unknown, dataTypeID?: number): unknown {
  if (value instanceof Date) {
    // Convex does not support JavaScript Date objects as values, so serialize
    // them before this Node action returns across the Convex boundary.
    if (dataTypeID === POSTGRES_DATE_OID) {
      // PostgreSQL `date` is a calendar date, not a moment in time. Keep only
      // YYYY-MM-DD to avoid implying a UTC midnight timestamp.
      return value.toISOString().slice(0, 10);
    }

    // PostgreSQL timestamp/timestamptz values do represent instants, so ISO is
    // a stable Convex-safe representation for them.
    return value.toISOString();
  }

  return value;
}

function normalizePgRowsForConvex(
  rows: Record<string, unknown>[],
  fields: Array<{ name: string; dataTypeID?: number }>,
): Record<string, unknown>[] {
  const fieldTypes = new Map(fields.map((field) => [field.name, field.dataTypeID]));

  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        normalizePgValueForConvex(value, fieldTypes.get(key)),
      ]),
    ),
  );
}

export function createPgExecutor(
  databaseUrl: string,
  cfgOverride?: Partial<ExecutorConfig>,
): PostgresExecutor {
  const cfg: ExecutorConfig = { ...loadExecutorConfig(), ...cfgOverride };

  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({
      connectionString: databaseUrl,
      // Belt-and-suspenders timeouts (server + client side).
      statement_timeout: cfg.statementTimeoutMs,
      query_timeout: cfg.statementTimeoutMs + 2_000,
      connectionTimeoutMillis: 8_000,
      application_name: "v7-analyst",
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  return {
    async listTables(): Promise<TableInfo[]> {
      return withClient(async (client) => {
        const res = await client.query(LIST_TABLES_SQL);
        return res.rows.map((r) => ({
          name: String(r.name),
          rowEstimate: r.row_estimate != null ? Number(r.row_estimate) : undefined,
        }));
      });
    },

    async describeTable(name: string): Promise<DescribeTableOutput> {
      return withClient(async (client) => {
        const cols = await client.query(describeTableSql(), [name]);
        const est = await client.query(ROW_ESTIMATE_SQL, [name]);
        return {
          table: name,
          columns: cols.rows.map((r) => ({
            name: String(r.name),
            type: String(r.type),
            nullable: Boolean(r.nullable),
          })),
          rowEstimate: est.rows[0]?.row_estimate != null
            ? Number(est.rows[0].row_estimate)
            : undefined,
        };
      });
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
        return await withClient(async (client) => {
          // READ ONLY transaction is a second layer of write protection.
          await client.query("BEGIN TRANSACTION READ ONLY");
          try {
            // Push the row cap into Postgres: without it, a query returning
            // millions of rows is fully materialized in this action's memory
            // before capRows trims it. The +1 preserves `truncated` detection
            // (capRows flags and slices anything beyond maxRows).
            const bounded = `select * from (${safeSql.replace(/;+\s*$/, "")}) as q limit ${
              cfg.maxRows + 1
            }`;
            const res = await client.query<Record<string, unknown>>(bounded);
            const normalizedRows = normalizePgRowsForConvex(res.rows, res.fields ?? []);
            const { rows, truncated } = capRows(normalizedRows, cfg);
            return {
              ok: true as const,
              columns: fieldsToColumns(res.fields ?? []),
              rows,
              rowCount: rows.length,
              truncated,
              executionTimeMs: Date.now() - startedAt,
              sql: safeSql,
            };
          } finally {
            await client.query("ROLLBACK").catch(() => undefined);
          }
        });
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
      // Per-query clients; nothing to close.
    },
  };
}
