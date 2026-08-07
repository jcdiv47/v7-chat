/**
 * The server entry point to the environment module.
 *
 * `server-only` makes an import of this file from a client component fail at
 * build time, so a stray import cannot pull `CLERK_SECRET_KEY` into the browser
 * bundle. The boundary is enforced by tooling rather than by review.
 *
 * That marker also means this file is importable only from a Next.js bundle:
 * plain Node entry points (the TUI, the eval runner, the seed script) must call
 * `parseServerEnv` from ./parse directly with whatever source they load.
 */
import "server-only";
import { formatProblems, parseServerEnv, type ServerEnv } from "./parse";

let cached: ServerEnv | undefined;

/**
 * The parsed server environment, memoized for the process lifetime.
 *
 * Throws with every problem listed at once, so fixing configuration is one pass
 * rather than a sequence of restarts. Nothing imports this yet — call sites move
 * over in a later change.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const result = parseServerEnv(process.env);
  if (!result.ok) throw new Error(formatProblems(result.problems));
  cached = result.env;
  return cached;
}

export type { ServerEnv } from "./parse";
