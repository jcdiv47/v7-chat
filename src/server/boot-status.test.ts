import { describe, expect, it } from "vitest";
import { formatBootCapabilityStatus } from "./boot-status";

describe("formatBootCapabilityStatus", () => {
  it("reports every real optional capability", () => {
    expect(
      formatBootCapabilityStatus({
        tracing: true,
        modelProvider: "openrouter",
        realModel: true,
        analyticalDatabaseConfigured: true,
      }),
    ).toBe(
      "Langfuse tracing on, model provider openrouter (real model), analytical database real PostgreSQL",
    );
  });

  it("reports the web runtime's offline substitutes and pglite boundary", () => {
    expect(
      formatBootCapabilityStatus({
        tracing: false,
        modelProvider: "mock",
        realModel: false,
        analyticalDatabaseConfigured: false,
      }),
    ).toBe(
      "Langfuse tracing off, model provider mock (offline demo agent), analytical database not configured (pglite is available only to the TUI and eval runner, not the web runtime)",
    );
  });

  it("makes a missing live-provider key visible as an offline fallback", () => {
    expect(
      formatBootCapabilityStatus({
        tracing: false,
        modelProvider: "openrouter",
        realModel: false,
        analyticalDatabaseConfigured: true,
      }),
    ).toContain(
      "model provider openrouter, but OPENROUTER_API_KEY is not set — running the offline demo agent",
    );
  });
});
