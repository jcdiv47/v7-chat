/**
 * Shared Postgres executor contract + result shaping. Two implementations plug
 * in behind this interface: `pg` (real intermediate Postgres, used by the Convex
 * node action and the TUI when INTERMEDIATE_DATABASE_URL is set) and `pglite`
 * (in-process offline dev DB for the TUI / evals). All safety limits — read-only
 * guard, statement timeout, row cap, size cap — are applied consistently here.
 */
import type {
  DescribeTableOutput,
  RunSqlResult,
  SqlColumn,
  TableInfo,
} from "../agent/types";

export interface PostgresExecutor {
  listTables(): Promise<TableInfo[]>;
  describeTable(name: string): Promise<DescribeTableOutput>;
  runSql(input: { sql: string; purpose?: string }): Promise<RunSqlResult>;
  close(): Promise<void>;
}

export type ExecutorConfig = {
  statementTimeoutMs: number;
  maxRows: number;
  /** Cap on serialized result bytes returned to callers. */
  maxResultBytes: number;
};

export function loadExecutorConfig(): ExecutorConfig {
  const num = (name: string, fallback: number) => {
    const raw = process.env[name];
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    statementTimeoutMs: num("SQL_STATEMENT_TIMEOUT_MS", 10_000),
    maxRows: num("SQL_MAX_ROWS", 500),
    // Meaningfully below Convex's ~1MB document limit: the capped rows are
    // stored verbatim in a `table` artifact document, whose sql/title/metadata
    // also count against the limit.
    maxResultBytes: num("SQL_MAX_RESULT_BYTES", 700_000),
  };
}

/** Minimal OID → friendly type name map for common Postgres types. */
const OID_TYPE_NAMES: Record<number, string> = {
  16: "bool",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "text",
  114: "json",
  700: "float4",
  701: "float8",
  1043: "varchar",
  1082: "date",
  1114: "timestamp",
  1184: "timestamptz",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",
};

export function oidToTypeName(oid: number | undefined): string | undefined {
  if (oid == null) return undefined;
  return OID_TYPE_NAMES[oid] ?? `oid:${oid}`;
}

export function fieldsToColumns(
  fields: Array<{ name: string; dataTypeID?: number }>,
): SqlColumn[] {
  return fields.map((f) => ({ name: f.name, type: oidToTypeName(f.dataTypeID) }));
}

/**
 * Apply row + serialized-size caps to a fetched result set. Returns the capped
 * rows and whether truncation occurred. Postgres `statement_timeout` bounds
 * runtime; this bounds the payload handed back to the model and Convex.
 */
export function capRows(
  rows: Record<string, unknown>[],
  cfg: ExecutorConfig,
): { rows: Record<string, unknown>[]; truncated: boolean } {
  let truncated = false;
  let capped = rows;
  if (capped.length > cfg.maxRows) {
    capped = capped.slice(0, cfg.maxRows);
    truncated = true;
  }
  // Enforce the serialized-size cap by dropping rows until it fits.
  while (capped.length > 0) {
    const size = Buffer.byteLength(JSON.stringify(capped), "utf8");
    if (size <= cfg.maxResultBytes) break;
    const dropTo = Math.max(1, Math.floor(capped.length * 0.75));
    if (dropTo >= capped.length) {
      capped = capped.slice(0, capped.length - 1);
    } else {
      capped = capped.slice(0, dropTo);
    }
    truncated = true;
  }
  return { rows: capped, truncated };
}

/** Normalize any thrown error into a concise message for the model/UI. */
export function toConciseDbError(err: unknown): string {
  if (err && typeof err === "object") {
    const anyErr = err as { message?: string; code?: string };
    const code = anyErr.code ? ` [${anyErr.code}]` : "";
    if (anyErr.message) return `${anyErr.message}${code}`.slice(0, 500);
  }
  return String(err).slice(0, 500);
}

/** SQL used by both executors to list base tables in the aiqa schema. */
export const LIST_TABLES_SQL = `
  select c.relname as name,
         greatest(c.reltuples, 0)::bigint as row_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'aiqa'
    and c.relkind in ('r', 'p', 'v', 'm')
  order by c.relname
`;

export function describeTableSql(): string {
  return `
    select column_name as name,
           data_type as type,
           (is_nullable = 'YES') as nullable
    from information_schema.columns
    where table_schema = 'aiqa' and table_name = $1
    order by ordinal_position
  `;
}

export const ROW_ESTIMATE_SQL = `
  select greatest(c.reltuples, 0)::bigint as row_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'aiqa' and c.relname = $1
`;
