import { afterEach, describe, expect, it } from "vitest";
import { setEnv as stub, restoreEnv } from "../../test/env";
import { loadExecutorConfig } from "./executor";

const NAMES = [
  "SQL_STATEMENT_TIMEOUT_MS",
  "SQL_MAX_ROWS",
  "SQL_MAX_RESULT_BYTES",
] as const;

const setEnv = (values: Partial<Record<(typeof NAMES)[number], string>>) =>
  stub(NAMES, values);

afterEach(restoreEnv);

describe("loadExecutorConfig", () => {
  it("falls back to the documented defaults when nothing is set", () => {
    setEnv({});
    expect(loadExecutorConfig()).toEqual({
      statementTimeoutMs: 10_000,
      maxRows: 500,
      maxResultBytes: 700_000,
    });
  });

  it("applies overrides as numbers", () => {
    setEnv({
      SQL_STATEMENT_TIMEOUT_MS: "30000",
      SQL_MAX_ROWS: "50",
      SQL_MAX_RESULT_BYTES: "1000",
    });
    expect(loadExecutorConfig()).toEqual({
      statementTimeoutMs: 30_000,
      maxRows: 50,
      maxResultBytes: 1000,
    });
  });

  it("rejects a non-positive limit instead of silently using the default", () => {
    setEnv({ SQL_MAX_ROWS: "0" });
    expect(() => loadExecutorConfig()).toThrow(/SQL_MAX_ROWS/);
  });
});
