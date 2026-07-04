/**
 * Basic read-only SQL guard. This is a *reliability control*, not the V2 policy
 * engine (docs/specs/03-data-access.md). It rejects statements that obviously
 * are not read-only before they ever reach Postgres, as defense-in-depth on top
 * of the read-only database role and statement timeouts.
 *
 * Pure and runtime-agnostic: used by the Convex node action, the TUI, and evals.
 */

export class SqlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlGuardError";
  }
}

/** Keywords that indicate a write, DDL, or side-effecting statement. Matched as
 * whole words, so column names like `created_at` or `update_time` are safe. */
const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CREATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "CALL",
  "DO",
  "MERGE",
  "VACUUM",
  "REINDEX",
  "CLUSTER",
  "LOCK",
  "LISTEN",
  "NOTIFY",
  "PREPARE",
  "EXECUTE",
  "DECLARE",
  "FETCH",
  "MOVE",
  "REFRESH",
] as const;

/** Remove comments, string literals, quoted identifiers, and dollar-quoted
 * blocks so keyword/semicolon scanning only sees SQL structure, not data. */
function stripLiteralsAndComments(sql: string): string {
  let s = sql;
  s = s.replace(/--[^\n]*/g, " "); // line comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, " "); // block comments
  // dollar-quoted strings ($tag$ ... $tag$) — do this before single quotes
  s = s.replace(/\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, " ");
  s = s.replace(/'(?:[^']|'')*'/g, "''"); // single-quoted string literals
  s = s.replace(/"(?:[^"]|"")*"/g, '"id"'); // double-quoted identifiers
  return s;
}

/**
 * Throws {@link SqlGuardError} if `rawSql` is not a single read-only
 * SELECT/WITH statement. Returns the trimmed SQL (safe to execute) on success.
 */
export function assertReadOnlySql(rawSql: string): string {
  const trimmed = rawSql.trim();
  if (!trimmed) {
    throw new SqlGuardError("Empty SQL statement.");
  }

  const scan = stripLiteralsAndComments(trimmed);
  const withoutTrailing = scan.replace(/;+\s*$/, "").trim();

  if (withoutTrailing.includes(";")) {
    throw new SqlGuardError(
      "Multiple SQL statements are not allowed. Run one read-only query at a time.",
    );
  }

  const firstWord = (withoutTrailing.match(/^\(*\s*([A-Za-z]+)/)?.[1] ?? "").toUpperCase();
  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    throw new SqlGuardError(
      `Only read-only SELECT / WITH queries are allowed (statement starts with "${
        firstWord || "?"
      }").`,
    );
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${keyword}\\b`, "i");
    if (re.test(withoutTrailing)) {
      throw new SqlGuardError(
        `The keyword "${keyword}" is not permitted in read-only queries. ` +
          "Data-modifying statements (including data-modifying CTEs) are blocked.",
      );
    }
  }

  return trimmed;
}

/** Quick predicate form of {@link assertReadOnlySql}. */
export function isReadOnlySql(sql: string): boolean {
  try {
    assertReadOnlySql(sql);
    return true;
  } catch {
    return false;
  }
}
