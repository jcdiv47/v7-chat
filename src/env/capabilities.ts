/**
 * The capability-gated slice of the environment, memoized for the process
 * lifetime.
 *
 * This is the accessor for modules under `src/lib/` — the model registry, the
 * app-version resolver, the SQL executor config. Those modules are shared with
 * the TUI and the eval runner, plain Node processes with no app database and no
 * Clerk keys, so they must not depend on core configuration. Modules under
 * `src/server/` use ./server instead.
 *
 * **This file is server code without a `server-only` marker, and it does carry
 * secrets** — `OPENROUTER_API_KEY` and `LANGFUSE_SECRET_KEY` among them. The
 * marker is absent because it would break the TUI and the eval runner, which
 * are not Next.js bundles; it is not absent because this is safe to import from
 * a client component. Nothing enforces that, so: no client component may import
 * this module, directly or transitively. Client code reads ./public.
 *
 * One consequence of reading `process.env` dynamically: `NEXT_PUBLIC_*` values
 * would be `undefined` here in a browser bundle, since Next.js only inlines
 * literal `process.env.NEXT_PUBLIC_X` member expressions (see ./public). On the
 * server, where this runs, the real environment is there and it does not
 * matter — but it is a second reason the rule above is a rule.
 *
 * Nothing here is required, so this only throws on a value that is set and
 * malformed. Whether a *capability* is configured stays the call site's
 * question, answered lazily and with its own error text.
 */
import {
  formatProblems,
  parseCapabilityEnv,
  type CapabilityEnv,
} from "./parse";

let cached: CapabilityEnv | undefined;

export function capabilityEnv(): CapabilityEnv {
  if (cached) return cached;
  const result = parseCapabilityEnv(process.env);
  if (!result.ok) throw new Error(formatProblems(result.problems));
  cached = result.env;
  return cached;
}

/**
 * Test seam: drop the memoized parse so the next read sees `process.env` again.
 * Only this cache — ./server memoizes separately. Prefer src/test/env.ts, which
 * calls this for you.
 */
export function resetCapabilityEnv(): void {
  cached = undefined;
}

export type { CapabilityEnv } from "./parse";
