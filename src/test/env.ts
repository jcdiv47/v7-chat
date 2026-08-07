/**
 * Test helper for the one thing the environment module cannot test purely: the
 * memoized accessors that read `process.env`.
 *
 * `setEnv` clears every name in `names` before applying `values`, so a test
 * never sees a value another test — or the developer's own shell — happened to
 * leave behind, and it drops the memoized parse so the next read sees the
 * change. `restoreEnv` in an `afterEach` puts everything back.
 *
 * Prefer `parseCapabilityEnv` / `parseServerEnv` directly wherever a test can
 * pass a literal object instead; reach for this only when the memoization or
 * the `process.env` read *is* the thing under test.
 */
import { vi } from "vitest";
import { resetCapabilityEnv } from "../env/capabilities";

/**
 * `vi.stubEnv` is typed against Vite's own `PROD`/`DEV`/`SSR` booleans, which
 * makes `undefined` (its documented way to unset a variable) unassignable for
 * an arbitrary name. Nothing here stubs those three.
 */
const stub = vi.stubEnv as (name: string, value: string | undefined) => void;

export function setEnv<N extends string>(
  names: readonly N[],
  values: Partial<Record<N, string>>,
): void {
  for (const name of names) stub(name, undefined);
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === "string") stub(name, value);
  }
  resetCapabilityEnv();
}

export function restoreEnv(): void {
  vi.unstubAllEnvs();
  resetCapabilityEnv();
}
