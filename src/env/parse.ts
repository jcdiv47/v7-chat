/**
 * The pure core of the environment module.
 *
 * `parseServerEnv` / `parsePublicEnv` take a plain string record and return a
 * discriminated result: parsed values on success, a list of structured problems
 * on failure. They never read `process.env`, never throw, and never log — every
 * other export in this module is a thin wrapper that supplies `process.env` and
 * decides what to do with a failure.
 *
 * That purity is the point: it is what makes the whole configuration surface
 * testable without mutating global state.
 */
import { z } from "zod";
import {
  DEV_DATABASE_URL,
  modelProviders,
  publicVariables,
  seedDatabaseUrlChain,
  serverVariables,
  type Capability,
  type Declaration,
  type ServerVariableName,
  type VariableTable,
} from "./variables";

/** What a caller hands in: `process.env`, or a literal in a test. */
export type EnvSource = Record<string, string | undefined>;

export type EnvProblem = {
  /** The variable name, e.g. `DRAIN_GRACE_MS`. */
  variable: string;
  /** A phrase completing "expected …". */
  expected: string;
  /** The value as received, redacted when the variable is a secret. */
  received: string;
};

export type ParseResult<T> =
  | { ok: true; env: T }
  | { ok: false; problems: EnvProblem[] };

/**
 * One definition of "empty", applied to every variable: surrounding whitespace
 * is trimmed, and a value that is empty or whitespace-only counts as absent.
 * A value copied from a dashboard with a stray space must not fail in a way
 * that looks like a wrong key.
 */
function normalize(source: EnvSource): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) normalized[name] = trimmed;
  }
  return normalized;
}

type SchemaShape<T extends VariableTable> = { [K in keyof T]: T[K]["schema"] };

function objectSchema<T extends VariableTable>(table: T) {
  const shape = Object.fromEntries(
    Object.entries(table).map(([name, declaration]) => [
      name,
      declaration.schema,
    ]),
  ) as SchemaShape<T>;
  return z.object(shape);
}

const serverSchema = objectSchema(serverVariables);
const publicSchema = objectSchema(publicVariables);

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

const REDACTED = (length: number) =>
  `«redacted, ${length} ${length === 1 ? "character" : "characters"}»`;

function renderReceived(declaration: Declaration, value: string | undefined) {
  if (value === undefined) return "(not set)";
  return declaration.secret ? REDACTED(value.length) : JSON.stringify(value);
}

/**
 * Turn a Zod failure into one problem per variable. Zod can report several
 * issues for the same variable (a refinement chain, say); the operator only
 * needs to be told once what the variable should look like.
 */
function toProblems(
  table: VariableTable,
  normalized: Record<string, string>,
  error: z.ZodError,
): EnvProblem[] {
  const seen = new Set<string>();
  const problems: EnvProblem[] = [];
  for (const issue of error.issues) {
    const variable = String(issue.path[0] ?? "");
    if (!variable || seen.has(variable)) continue;
    seen.add(variable);
    const declaration = table[variable];
    problems.push({
      variable,
      // Undeclared variables cannot reach here — the object schema strips them
      // — but falling back keeps this total, so a failed parse always yields at
      // least one problem.
      expected: declaration?.expectation ?? issue.message,
      received: declaration
        ? renderReceived(declaration, normalized[variable])
        : "(undeclared variable)",
    });
  }
  return problems;
}

/**
 * Conditional requirements, encoded rather than implied.
 *
 * `MODEL_PROVIDER=mock` relaxes `OPENROUTER_API_KEY` and
 * `INTERMEDIATE_DATABASE_URL` from required-for-capability to unused. Expressing
 * it here — over the whole environment — rather than leaving it to whichever
 * code path happens to throw first is what makes demo mode a declared contract.
 *
 * Computed from the normalized source rather than from the parsed object so
 * that these problems aggregate with the shape problems instead of hiding
 * behind them.
 *
 * Note that this is stricter than what the running app does today, where an
 * absent `OPENROUTER_API_KEY` silently falls back to the demo agent. It applies
 * to `parseServerEnv` only: the scoped parses below deliberately skip it, since
 * a consumer that names its capabilities has already said what it requires.
 */
function conditionalProblems(normalized: Record<string, string>): EnvProblem[] {
  const provider = normalized.MODEL_PROVIDER;
  // An unknown provider is already reported by the enum; do not guess what it
  // was meant to be and pile conditional problems on top.
  if (provider !== undefined && !(modelProviders as readonly string[]).includes(provider)) {
    return [];
  }
  if (provider === "mock") return [];

  const problems: EnvProblem[] = [];
  const required = [
    {
      variable: "OPENROUTER_API_KEY",
      expected:
        "an OpenRouter API key, or MODEL_PROVIDER=mock to run the offline demo agent",
    },
    {
      variable: "INTERMEDIATE_DATABASE_URL",
      expected:
        "a Postgres connection URL for the analytical database, or MODEL_PROVIDER=mock to run the offline demo agent",
    },
  ] as const;
  for (const { variable, expected } of required) {
    if (normalized[variable] === undefined) {
      problems.push({
        variable,
        expected,
        received: "(not set)",
      });
    }
  }
  return problems;
}

/** Parse the full server environment. Pure: no `process.env`, no throw, no log. */
export function parseServerEnv(source: EnvSource): ParseResult<ServerEnv> {
  const normalized = normalize(source);
  const result = serverSchema.safeParse(normalized);
  const conditional = conditionalProblems(normalized);
  if (!result.success) {
    return {
      ok: false,
      problems: [
        ...toProblems(serverVariables, normalized, result.error),
        ...conditional,
      ],
    };
  }
  if (conditional.length > 0) return { ok: false, problems: conditional };
  return { ok: true, env: result.data };
}

/** Parse the `NEXT_PUBLIC_*` surface. Pure, as above. */
export function parsePublicEnv(source: EnvSource): ParseResult<PublicEnv> {
  const normalized = normalize(source);
  const result = publicSchema.safeParse(normalized);
  if (!result.success) {
    return {
      ok: false,
      problems: toProblems(publicVariables, normalized, result.error),
    };
  }
  return { ok: true, env: result.data };
}

/**
 * Scoped parses: one capability's worth of environment, for the consumers that
 * are not the Next.js server.
 *
 * The TUI, the eval runner, the seed script and the Drizzle config each use a
 * slice of the environment, and running the full server parse in them would be
 * wrong — the TUI must keep starting with no Clerk keys present, because it
 * never serves a page.
 *
 * Two deliberate differences from `parseServerEnv`:
 *
 * - Variables outside the requested capabilities are neither required nor
 *   validated. A broken `DRAIN_GRACE_MS` is the server's problem, not the TUI's.
 * - The conditional requirements are *not* applied. They express what the server
 *   needs in order to serve; a scoped consumer says what it needs by naming its
 *   capabilities. This is what preserves the offline paths: with no
 *   `OPENROUTER_API_KEY` the TUI still runs its slash commands, and with no
 *   `INTERMEDIATE_DATABASE_URL` it still falls back to the seeded pglite
 *   database — that fallback is now the schema's `.optional()` plus the one
 *   definition of "empty" above, rather than a bare truthiness check.
 */
type VariableNamesOf<C extends Capability> = {
  [K in ServerVariableName]: (typeof serverVariables)[K]["capability"] extends C
    ? K
    : never;
}[ServerVariableName];

export type ScopedEnv<C extends Capability> = Pick<ServerEnv, VariableNamesOf<C>>;

function subTable(names: readonly ServerVariableName[]): VariableTable {
  return Object.fromEntries(names.map((name) => [name, serverVariables[name]]));
}

function parseTable<T>(table: VariableTable, source: EnvSource): ParseResult<T> {
  const normalized = normalize(source);
  const result = objectSchema(table).safeParse(normalized);
  if (!result.success) {
    return { ok: false, problems: toProblems(table, normalized, result.error) };
  }
  return { ok: true, env: result.data as T };
}

/** Parse only the variables belonging to `capabilities`. Pure, as above. */
export function parseScopedEnv<const C extends readonly Capability[]>(
  capabilities: C,
  source: EnvSource,
): ParseResult<ScopedEnv<C[number]>> {
  const names = (Object.keys(serverVariables) as ServerVariableName[]).filter(
    (name) => capabilities.includes(serverVariables[name].capability),
  );
  return parseTable<ScopedEnv<C[number]>>(subTable(names), source);
}

/**
 * The seed script's one requirement: a writable connection, taken from the
 * declared fallback chain.
 *
 * Selection happens before validation, exactly as the `??` it replaces did:
 * the first link that is *set* wins, and only that one is validated. A stale
 * `INTERMEDIATE_DATABASE_URL` therefore cannot block a good
 * `SEED_DATABASE_URL` — the script never used the fallback in that case, so
 * neither does this. A malformed *chosen* URL is still rejected, which is the
 * point: a typo'd admin URL must fail rather than reach a driver.
 */
export function parseSeedEnv(
  source: EnvSource,
): ParseResult<{ seedDatabaseUrl: string }> {
  const normalized = normalize(source);
  const chosen = seedDatabaseUrlChain.find(
    (name) => normalized[name] !== undefined,
  );
  if (chosen) {
    const result = parseTable<Record<string, string>>(
      subTable([chosen]),
      source,
    );
    return result.ok
      ? { ok: true, env: { seedDatabaseUrl: result.env[chosen] } }
      : result;
  }
  // One problem, not one per link: the chain is a single missing value, and
  // naming its head plus the fallback is what an operator needs to act.
  const [head, ...fallbacks] = seedDatabaseUrlChain;
  return {
    ok: false,
    problems: [
      {
        variable: head,
        expected: `${serverVariables[head].expectation}, or ${fallbacks.join(" or ")} as a fallback`,
        received: "(not set)",
      },
    ],
  };
}

/**
 * The app database URL alone, defaulted to the dev database. Only the Drizzle
 * CLI uses this: the server has no default and must fail without one, but
 * `drizzle-kit generate` runs on a developer's machine against the Compose
 * database. See `DEV_DATABASE_URL`.
 */
export function parseAppDatabaseEnv(
  source: EnvSource,
): ParseResult<{ DATABASE_URL: string }> {
  const table: VariableTable = {
    DATABASE_URL: {
      ...serverVariables.DATABASE_URL,
      schema: serverVariables.DATABASE_URL.schema.default(DEV_DATABASE_URL),
    },
  };
  return parseTable<{ DATABASE_URL: string }>(table, source);
}

/**
 * Render problems one per line, naming the variable, the expectation and the
 * received value. The primary consumer of this text is a deploy log, which is
 * why secret values never appear in it.
 */
export function formatProblems(problems: EnvProblem[]): string {
  const lines = problems.map(
    (p) => `  ${p.variable}: expected ${p.expected}, received ${p.received}`,
  );
  const count =
    problems.length === 1 ? "1 problem" : `${problems.length} problems`;
  return `Invalid environment configuration (${count}):\n${lines.join("\n")}`;
}
