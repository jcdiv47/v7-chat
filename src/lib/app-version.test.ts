import { afterEach, describe, expect, it } from "vitest";
import { version as packageVersion } from "../../package.json";
import { setEnv as stub, restoreEnv } from "../test/env";
import { getAppVersion, getLangfuseRelease } from "./app-version";

const NAMES = ["APP_VERSION", "NEXT_PUBLIC_APP_VERSION", "LANGFUSE_RELEASE"] as const;

const setEnv = (values: Partial<Record<(typeof NAMES)[number], string>>) =>
  stub(NAMES, values);

afterEach(restoreEnv);

describe("getAppVersion", () => {
  it("prefers APP_VERSION, then NEXT_PUBLIC_APP_VERSION, then package.json", () => {
    setEnv({ APP_VERSION: "1.2.3", NEXT_PUBLIC_APP_VERSION: "9.9.9" });
    expect(getAppVersion()).toBe("v1.2.3");

    setEnv({ NEXT_PUBLIC_APP_VERSION: "9.9.9" });
    expect(getAppVersion()).toBe("v9.9.9");

    setEnv({});
    expect(getAppVersion()).toBe(`v${packageVersion}`);
  });

  it("keeps a leading v and passes non-semver values through", () => {
    setEnv({ APP_VERSION: "v2.0.0" });
    expect(getAppVersion()).toBe("v2.0.0");

    setEnv({ APP_VERSION: "2026-08-07-deadbeef" });
    expect(getAppVersion()).toBe("2026-08-07-deadbeef");
  });

  // The behaviour the four duplicate env() helpers disagreed on: only the
  // app-version one trimmed, so a pasted trailing space behaved differently
  // depending on which variable it landed in. Trimming is now universal.
  it("treats a whitespace-only or padded value the way a trimmed one behaves", () => {
    setEnv({ APP_VERSION: "   ", NEXT_PUBLIC_APP_VERSION: "3.1.4" });
    expect(getAppVersion()).toBe("v3.1.4");

    setEnv({ APP_VERSION: "  1.0.0\n" });
    expect(getAppVersion()).toBe("v1.0.0");
  });
});

describe("getLangfuseRelease", () => {
  it("uses LANGFUSE_RELEASE when set and the app version otherwise", () => {
    setEnv({ LANGFUSE_RELEASE: "4.5.6", APP_VERSION: "1.2.3" });
    expect(getLangfuseRelease()).toBe("v4.5.6");

    setEnv({ APP_VERSION: "1.2.3" });
    expect(getLangfuseRelease()).toBe("v1.2.3");
  });
});
