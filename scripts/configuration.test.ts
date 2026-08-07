import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { serverVariables, type VariableTable } from "../src/env/variables";
import {
  checkConfiguration,
  renderHostVariableTable,
  replaceGeneratedTables,
} from "./configuration";
import { stackVariables } from "./configuration-stack";

describe("configuration reference generation", () => {
  it("documents every declaration supplied by the app schema", () => {
    const declarations = {
      TEST_AUTO_DOCUMENTED: {
        capability: "tracing",
        schema: z.string().default("from-schema"),
        secret: false,
        consumer: "test consumer",
        expectation: "a test value",
        notes: "Added only to the schema fixture.",
      },
    } satisfies VariableTable;

    expect(renderHostVariableTable(declarations)).toContain(
      "| `TEST_AUTO_DOCUMENTED` | tracing | No | `from-schema` | test consumer | Added only to the schema fixture. |",
    );
  });

  it("includes variables previously missed by hand-maintained templates", () => {
    const table = renderHostVariableTable(serverVariables);

    expect(table).toContain("`SQL_MAX_RESULT_BYTES`");
    expect(table).toContain("`NEXT_PUBLIC_APP_VERSION`");
  });

  it("documents consumer-specific requirements and defaults", () => {
    const table = renderHostVariableTable(serverVariables);

    expect(table).toContain(
      "| `DATABASE_URL` | core | Yes (app); No (Drizzle CLI) | none (app); `postgres://v7:v7@localhost:5433/v7_chat` (Drizzle CLI) |",
    );
  });

  it("replaces only marked generated regions", () => {
    const source = [
      "hand-written preamble",
      "<!-- BEGIN GENERATED HOST CONFIGURATION -->",
      "stale host table",
      "<!-- END GENERATED HOST CONFIGURATION -->",
      "hand-written compose explanation",
      "<!-- BEGIN GENERATED STACK CONFIGURATION -->",
      "stale stack table",
      "<!-- END GENERATED STACK CONFIGURATION -->",
      "hand-written suffix",
      "",
    ].join("\n");

    const generated = replaceGeneratedTables(source);

    expect(generated).toContain("hand-written preamble");
    expect(generated).toContain("hand-written compose explanation");
    expect(generated).toContain("hand-written suffix");
    expect(generated).not.toContain("stale host table");
    expect(generated).not.toContain("stale stack table");
  });
});

describe("configuration checks", () => {
  it("reproduces the committed reference byte for byte", async () => {
    const [document, hostTemplate, stackTemplate] = await Promise.all([
      readFile("docs/configuration.md", "utf8"),
      readFile(".env.example", "utf8"),
      readFile("deploy/stack.env.example", "utf8"),
    ]);

    expect(
      checkConfiguration({ document, hostTemplate, stackTemplate }).problems,
    ).toEqual([]);
  });

  it("reports a stale committed reference", () => {
    const result = checkConfiguration({
      document: [
        "<!-- BEGIN GENERATED HOST CONFIGURATION -->",
        "stale",
        "<!-- END GENERATED HOST CONFIGURATION -->",
        "<!-- BEGIN GENERATED STACK CONFIGURATION -->",
        "stale",
        "<!-- END GENERATED STACK CONFIGURATION -->",
      ].join("\n"),
      hostTemplate: Object.keys(serverVariables)
        .map((name) => `${name}=`)
        .join("\n"),
      stackTemplate: Object.keys(stackVariables)
        .map((name) => `${name}=`)
        .join("\n"),
    });

    expect(result.problems).toContain(
      "docs/configuration.md is stale; run npm run config:generate",
    );
  });

  it("reports required schema variables omitted from a template", () => {
    const result = checkConfiguration({
      document: [
        "<!-- BEGIN GENERATED HOST CONFIGURATION -->",
        renderHostVariableTable(serverVariables),
        "<!-- END GENERATED HOST CONFIGURATION -->",
        "<!-- BEGIN GENERATED STACK CONFIGURATION -->",
        "placeholder",
        "<!-- END GENERATED STACK CONFIGURATION -->",
      ].join("\n"),
      hostTemplate: "DATABASE_URL=\nNEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=\n",
      stackTemplate: Object.keys(stackVariables)
        .map((name) => `${name}=`)
        .join("\n"),
    });

    expect(result.problems).toContain(
      ".env.example omits required variable CLERK_SECRET_KEY",
    );
  });
});
