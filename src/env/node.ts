/**
 * The entry point for the consumers that are *not* the Next.js server: the TUI,
 * the eval runner, the seed script and the Drizzle config.
 *
 * They cannot use ./server — `server-only` makes that file importable from a
 * Next.js bundle and nowhere else — and they should not use it either: each one
 * needs a slice of the environment, and requiring the whole server schema would
 * stop the TUI from starting without Clerk keys.
 *
 * So each consumer names the capabilities it uses and gets exactly those,
 * validated. Everything here is a thin wrapper over the pure functions in
 * ./parse: it supplies `process.env`, and throws with every problem listed at
 * once. These processes are interactive or one-shot, so throwing at the top of
 * `main` is the whole error strategy.
 */
import {
  formatProblems,
  parseAppDatabaseEnv,
  parseScopedEnv,
  parseSeedEnv,
  type ParseResult,
  type ScopedEnv,
} from "./parse";
import type { Capability } from "./variables";

function unwrap<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new Error(formatProblems(result.problems));
  return result.env;
}

/**
 * Load `.env.local` into `process.env`, if it exists — Node 20.12+'s built-in
 * loader, which every one of these scripts used to inline for itself. Next.js
 * does this for the server; a plain `tsx script.ts` does not.
 *
 * Absent file, unreadable file, ancient Node: all mean "rely on the ambient
 * environment", which is what a container or a CI job provides.
 */
function loadDotEnvLocal(): void {
  try {
    (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(
      ".env.local",
    );
  } catch {
    /* ambient env */
  }
}

/**
 * Load `.env.local` and parse the named capabilities. Throws with every problem
 * listed at once, so fixing configuration is one pass rather than a sequence of
 * restarts.
 */
export function loadNodeEnv<const C extends readonly Capability[]>(
  capabilities: C,
): ScopedEnv<C[number]> {
  loadDotEnvLocal();
  return unwrap(parseScopedEnv(capabilities, process.env));
}

/**
 * What the two agent CLIs — the TUI and the eval runner — need: a model
 * provider and an analytical database, and nothing else. Neither serves a page,
 * so neither requires the Clerk keys or the app database, and both must keep
 * starting without them.
 */
export function loadAgentCliEnv() {
  return loadNodeEnv(["model-provider", "analytical-database"]);
}

/** As `loadNodeEnv`, for the seed script's declared fallback chain. */
export function loadSeedEnv(): { seedDatabaseUrl: string } {
  loadDotEnvLocal();
  return unwrap(parseSeedEnv(process.env));
}

/**
 * The app database URL for the Drizzle CLI, defaulted to the dev database.
 *
 * Deliberately does not load `.env.local`: drizzle-kit does its own env
 * loading, and adding a second loader here would change which file wins.
 */
export function drizzleDatabaseUrl(): string {
  return unwrap(parseAppDatabaseEnv(process.env)).DATABASE_URL;
}
