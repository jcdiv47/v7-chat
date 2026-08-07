/**
 * The public entry point to the environment module: the `NEXT_PUBLIC_*`
 * variables, and nothing else. Safe to import from a client component.
 *
 * Read docs/configuration.md → "Build-time vs. runtime" for why these values
 * behave differently from the rest.
 */
import { formatProblems, parsePublicEnv, type PublicEnv } from "./parse";

/**
 * DO NOT "SIMPLIFY" THIS INTO A LOOP OR A DYNAMIC LOOKUP.
 *
 * Next.js inlines public variables into the client bundle at build time by
 * textually replacing literal `process.env.NEXT_PUBLIC_X` member expressions
 * with their values. `process.env[name]`, `Object.entries(process.env)`, or any
 * other dynamic access is not a member expression the compiler can see, so it
 * is never replaced — and reads as `undefined` in the browser. Every one of
 * these must stay written out longhand.
 */
const rawPublicEnv = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
  NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
};

let cached: PublicEnv | undefined;

/**
 * The parsed public environment, memoized for the process lifetime. Nothing
 * imports this yet — call sites move over in a later change.
 */
export function publicEnv(): PublicEnv {
  if (cached) return cached;
  const result = parsePublicEnv(rawPublicEnv);
  if (!result.ok) throw new Error(formatProblems(result.problems));
  cached = result.env;
  return cached;
}

export type { PublicEnv } from "./parse";
