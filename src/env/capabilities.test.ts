/**
 * Tests for the memoized capability accessor. Unlike the pure parse tests,
 * these do mutate `process.env` — reading it, and reading it exactly once, is
 * the whole of what this module adds over `parseCapabilityEnv`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setEnv, restoreEnv } from "../test/env";
import { capabilityEnv } from "./capabilities";

const NAMES = [
  "MODEL_PROVIDER",
  "MODEL_ANALYST",
  "SQL_MAX_ROWS",
  "OPENROUTER_API_KEY",
  "INTERMEDIATE_DATABASE_URL",
] as const;

const set = (values: Partial<Record<(typeof NAMES)[number], string>>) =>
  setEnv(NAMES, values);

afterEach(restoreEnv);

describe("capabilityEnv", () => {
  it("reads process.env through the declared schema", () => {
    set({ MODEL_ANALYST: "  vendor/model  ", SQL_MAX_ROWS: "42" });
    expect(capabilityEnv().MODEL_ANALYST).toBe("vendor/model");
    expect(capabilityEnv().SQL_MAX_ROWS).toBe(42);
  });

  it("memoizes: a later mutation of process.env is not observed", () => {
    set({ MODEL_ANALYST: "vendor/first" });
    expect(capabilityEnv().MODEL_ANALYST).toBe("vendor/first");
    process.env.MODEL_ANALYST = "vendor/second";
    expect(capabilityEnv().MODEL_ANALYST).toBe("vendor/first");
  });

  it("throws once with every problem listed, naming each variable", () => {
    set({ MODEL_PROVIDER: "mocked", SQL_MAX_ROWS: "-3" });
    expect(() => capabilityEnv()).toThrow(/MODEL_PROVIDER[\s\S]*SQL_MAX_ROWS/);
  });

  it("succeeds with no model key and no analytical database", () => {
    set({});
    expect(capabilityEnv().MODEL_PROVIDER).toBe("openrouter");
    expect(capabilityEnv().OPENROUTER_API_KEY).toBeUndefined();
    expect(capabilityEnv().INTERMEDIATE_DATABASE_URL).toBeUndefined();
  });
});
