import { afterEach, describe, expect, it } from "vitest";
import { setEnv as stub, restoreEnv } from "../../test/env";
import { allModelDefs, hasRealModel, resolveModelDef } from "./registry";

const NAMES = [
  "MODEL_PROVIDER",
  "OPENROUTER_API_KEY",
  "MODEL_FAST",
  "MODEL_ANALYST",
  "MODEL_SQL",
  "MODEL_SUMMARIZER",
  "MODEL_ANALYST_REASONING",
] as const;

const setEnv = (values: Partial<Record<(typeof NAMES)[number], string>>) =>
  stub(NAMES, values);

afterEach(restoreEnv);

describe("hasRealModel", () => {
  it("is true only with a live provider and a key", () => {
    setEnv({ OPENROUTER_API_KEY: "sk-or-v1-abc" });
    expect(hasRealModel()).toBe(true);
  });

  it("is false in demo mode, key or no key", () => {
    setEnv({ MODEL_PROVIDER: "mock", OPENROUTER_API_KEY: "sk-or-v1-abc" });
    expect(hasRealModel()).toBe(false);

    setEnv({ MODEL_PROVIDER: "mock" });
    expect(hasRealModel()).toBe(false);
  });

  it("is false with no key at all", () => {
    setEnv({});
    expect(hasRealModel()).toBe(false);
  });

  // Previously `env("MODEL_PROVIDER") !== "mock"` treated any typo as live,
  // silently sending traffic to a provider with a key that may not exist.
  it("rejects a typo'd provider rather than treating it as live", () => {
    setEnv({ MODEL_PROVIDER: "mocked", OPENROUTER_API_KEY: "sk-or-v1-abc" });
    expect(() => hasRealModel()).toThrow(/MODEL_PROVIDER/);
  });
});

describe("resolveModelDef", () => {
  it("uses the declared defaults when nothing overrides them", () => {
    setEnv({});
    expect(resolveModelDef("analyst")).toMatchObject({
      alias: "analyst",
      modelId: "z-ai/glm-5.2:nitro",
      reasoning: "low",
    });
  });

  it("applies MODEL_* and MODEL_*_REASONING overrides", () => {
    setEnv({ MODEL_ANALYST: "vendor/model", MODEL_ANALYST_REASONING: "high" });
    expect(resolveModelDef("analyst")).toMatchObject({
      modelId: "vendor/model",
      reasoning: "high",
    });
  });

  it("covers every alias", () => {
    setEnv({});
    expect(allModelDefs().map((d) => d.alias)).toEqual([
      "fast",
      "analyst",
      "sql",
      "summarizer",
    ]);
    for (const def of allModelDefs()) {
      expect(def.modelId).not.toBe("");
    }
  });
});
