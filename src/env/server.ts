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
 * rather than a sequence of restarts. `bootServer` calls this before migrations
 * run, which is what moves a missing `DATABASE_URL` or Clerk key from a
 * first-request failure to a deploy-time one.
 *
 * Capability requirements are not enforced here — see `ServerParseOptions`.
 * A missing OpenRouter key or analytical database URL still surfaces at first
 * use, from the code that needs it and knows what to say about it.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const result = parseServerEnv(process.env, { requireCapabilities: false });
  if (!result.ok) throw new Error(formatProblems(result.problems));
  cached = result.env;
  return cached;
}

export type { ServerEnv } from "./parse";
