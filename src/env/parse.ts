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
  capabilityVariables,
  modelProviders,
  publicVariables,
  serverVariables,
  type Declaration,
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
const capabilitySchema = objectSchema(capabilityVariables);

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;
export type CapabilityEnv = z.infer<typeof capabilitySchema>;

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
 * This is stricter than what the running app does, where an absent
 * `OPENROUTER_API_KEY` falls back to the demo agent — which is why the server's
 * boot check turns it off. See `ServerParseOptions`.
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

export type ServerParseOptions = {
  /**
   * Enforce the conditional requirements above: a live provider must have an
   * OpenRouter key and an analytical database URL.
   *
   * The server's boot check passes `false`. Those two variables are gated on a
   * capability, and the call sites that need the capability already throw with
   * error text naming the fix — "set MODEL_PROVIDER=mock to use the offline
   * demo runner" beats anything generic validation can say. Boot enforcing them
   * would also break the two configurations that must keep working: demo mode,
   * and a dev server started before its model key is filled in.
   *
   * Defaults to `true`: the whole-environment check, which is the contract this
   * function was introduced with and the one its tests pin. Nothing in the
   * server passes it today — the server always opts out.
   */
  requireCapabilities?: boolean;
};

/** Parse the full server environment. Pure: no `process.env`, no throw, no log. */
export function parseServerEnv(
  source: EnvSource,
  options: ServerParseOptions = {},
): ParseResult<ServerEnv> {
  const normalized = normalize(source);
  const result = serverSchema.safeParse(normalized);
  const conditional =
    options.requireCapabilities === false ? [] : conditionalProblems(normalized);
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

/**
 * Parse only the capability-gated variables — everything except core. Nothing
 * here is ever required, so this succeeds on an empty environment; it validates
 * the shape of whatever *is* set. See `capabilityVariables` for why the slice
 * exists.
 */
export function parseCapabilityEnv(source: EnvSource): ParseResult<CapabilityEnv> {
  const normalized = normalize(source);
  const result = capabilitySchema.safeParse(normalized);
  if (!result.success) {
    return {
      ok: false,
      problems: toProblems(capabilityVariables, normalized, result.error),
    };
  }
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
