import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  evaluateRailwayFile,
  validateGraph,
  type CompileResult,
} from "railway/iac";

let evaluationPromise: Promise<CompileResult> | undefined;

function evaluateRailwayConfiguration(): Promise<CompileResult> {
  evaluationPromise ??= evaluateRailwayFile(".railway/railway.ts");
  return evaluationPromise;
}

describe("Railway infrastructure", () => {
  it("compiles with the pinned Railway SDK", async () => {
    const evaluation = await evaluateRailwayConfiguration();

    expect(validateGraph(evaluation.graph)).toEqual([]);
  });

  it("keeps the app singleton draining and both databases private", async () => {
    const { desiredConfig } = await evaluateRailwayConfiguration();
    const app = desiredConfig.services?.app;
    const appDatabase = desiredConfig.services?.["app-db"];
    const intermediateDatabase = desiredConfig.services?.["intermediate-db"];

    expect(app?.deploy).toMatchObject({
      drainingSeconds: 40,
      healthcheckPath: "/api/health",
      numReplicas: 1,
    });
    expect(appDatabase?.variables?.DATABASE_URL?.value).toContain(
      "RAILWAY_PRIVATE_DOMAIN",
    );
    expect(appDatabase?.networking?.tcpProxies).toBeUndefined();
    expect(intermediateDatabase?.networking?.tcpProxies).toBeUndefined();
    expect(intermediateDatabase?.build?.watchPatterns).toEqual([
      "/deploy/railway/intermediate-db/**",
    ]);
  });

  it("keeps Railway and AWS analytical role initialization identical", async () => {
    const [aws, railway] = await Promise.all([
      readFile("deploy/postgres/init-intermediate.sh", "utf8"),
      readFile("deploy/railway/intermediate-db/init-intermediate.sh", "utf8"),
    ]);

    expect(railway).toBe(aws);
  });
});
