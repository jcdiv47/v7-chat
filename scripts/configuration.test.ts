import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { serverVariables, type VariableTable } from "../src/env/variables";
import {
  checkConfiguration,
  renderHostVariableTable,
  renderStackVariableTable,
  replaceGeneratedTables,
} from "./configuration";
import {
  stackVariables,
  type StackVariableTable,
} from "./configuration-stack";

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
    const [document, hostTemplate, stackTemplate, composeFile] =
      await Promise.all([
        readFile("docs/configuration.md", "utf8"),
        readFile(".env.example", "utf8"),
        readFile("deploy/stack.env.example", "utf8"),
        readFile("docker-compose.prod.yml", "utf8"),
      ]);

    expect(
      checkConfiguration({ document, hostTemplate, stackTemplate, composeFile })
        .problems,
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
      composeFile: "services:\n  app:\n    environment:\n",
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
      composeFile: "services:\n  app:\n    environment:\n",
    });

    expect(result.problems).toContain(
      ".env.example omits required variable CLERK_SECRET_KEY",
    );
  });

  it.each([
    "      SQL_MAX_ROWS: ${SQL_MAX_ROWS:-500}",
    '      SQL_MAX_ROWS: "${SQL_MAX_ROWS:-500}"',
    "      SQL_MAX_ROWS: '${SQL_MAX_ROWS:-500}'",
    "      SQL_MAX_ROWS: ${SQL_MAX_ROWS:-500} # tune per host",
    '      SQL_MAX_ROWS: "${SQL_MAX_ROWS:-500}" # tune per host',
    "      SQL_MAX_ROWS: '${SQL_MAX_ROWS:-500}' # tune per host",
    '      SQL_MAX_ROWS: "${SQL_MAX_ROWS:-500 # not a YAML comment}"',
  ])("reports app-schema defaults in Compose scalar %s", (declaration) => {
    const result = checkConfiguration(
      validInput(
        [
          declaration,
          "      LANGFUSE_ENVIRONMENT: ${LANGFUSE_ENVIRONMENT:-production}",
        ].join("\n"),
      ),
    );

    expect(result.problems).toContain(
      "docker-compose.prod.yml pins SQL_MAX_ROWS; use ${SQL_MAX_ROWS:-} so the app schema supplies its default",
    );
  });

  it("accepts pass-throughs and a default for an app variable with no schema default", () => {
    const result = checkConfiguration(
      validInput(
        [
          "      SQL_MAX_ROWS: ${SQL_MAX_ROWS:-}",
          "      APP_VERSION: ${APP_VERSION:-v1.2.3}",
          "      LANGFUSE_ENVIRONMENT: ${LANGFUSE_ENVIRONMENT:-production}",
        ].join("\n"),
      ),
    );

    expect(result.problems).toEqual([]);
  });

  it("reports a variable declared as reaching the app when Compose omits it", () => {
    const result = checkConfiguration(
      validInput("", ["SQL_MAX_RESULT_BYTES"]),
    );

    expect(result.problems).toContain(
      "docker-compose.prod.yml omits SQL_MAX_RESULT_BYTES, which is declared as reaching the app",
    );
  });

  it("reports a declared production default when Compose diverges", () => {
    const result = checkConfiguration(
      validInput(
        "      LANGFUSE_ENVIRONMENT: ${LANGFUSE_ENVIRONMENT:-staging}",
      ),
    );

    expect(result.problems).toContain(
      "docker-compose.prod.yml must pin LANGFUSE_ENVIRONMENT to its declared production default production",
    );
  });

  it("ignores assembled and fixed Compose values", () => {
    const result = checkConfiguration(
      validInput(
        [
          "      DATABASE_URL: postgresql://v7:${APP_DB_PASSWORD}@app-db:5432/v7_chat",
          "      OPENROUTER_APP_URL: https://${DOMAIN}",
          "      NEXT_PUBLIC_CLERK_SIGN_IN_URL: /sign-in",
          '      NEXT_MANUAL_SIG_HANDLE: "true"',
          "      LANGFUSE_ENVIRONMENT: ${LANGFUSE_ENVIRONMENT:-production}",
        ].join("\n"),
      ),
    );

    expect(result.problems).toEqual([]);
  });

  it("reports every drifted Compose default in one pass", () => {
    const result = checkConfiguration(
      validInput(
        [
          "      SQL_MAX_ROWS: ${SQL_MAX_ROWS:-500}",
          "      DRAIN_GRACE_MS: ${DRAIN_GRACE_MS:-25000}",
          "      LANGFUSE_ENVIRONMENT: ${LANGFUSE_ENVIRONMENT:-production}",
        ].join("\n"),
      ),
    );

    expect(result.problems).toEqual([
      "docker-compose.prod.yml pins SQL_MAX_ROWS; use ${SQL_MAX_ROWS:-} so the app schema supplies its default",
      "docker-compose.prod.yml pins DRAIN_GRACE_MS; use ${DRAIN_GRACE_MS:-} so the app schema supplies its default",
    ]);
  });

  it.each([
    "app:\n  environment:",
    "services:\n  renamed-app:\n    environment:",
    "services:\n  app:\n    command: node server.js",
  ])("fails loudly when the app environment cannot be located", (composeFile) => {
    const result = checkConfiguration({ ...validInput(""), composeFile });

    expect(result.problems).toContain(
      "could not locate the app service environment in docker-compose.prod.yml",
    );
  });

  it("accepts nonstandard but valid indentation", () => {
    const environment = validComposeEnvironment("")
      .split("\n")
      .map((line) => `            ${line.trimStart()}`)
      .join("\n");
    const result = checkConfiguration({
      ...validInput(""),
      composeFile: [
        "services:",
        "    app:",
        "        environment:",
        environment,
      ].join("\n"),
    });

    expect(result.problems).toEqual([]);
  });
});

function validComposeEnvironment(
  environment: string,
  omitted: string[] = [],
): string {
  const omittedNames = new Set(omitted);
  const stackDeclarations: StackVariableTable = stackVariables;
  const declarations = Object.entries(stackDeclarations)
    .filter(
      ([name, declaration]) =>
        declaration.reachesApp === "Yes" && !omittedNames.has(name),
    )
    .map(([name, declaration]) =>
      declaration.pinComposeDefault
        ? `      ${name}: \${${name}:-${declaration.defaultValue}}`
        : `      ${name}: \${${name}:-}`,
    );
  if (environment) declarations.push(environment);
  return declarations.join("\n");
}

function validInput(environment: string, omitted: string[] = []) {
  return {
    document: [
      "<!-- BEGIN GENERATED HOST CONFIGURATION -->",
      renderHostVariableTable(serverVariables),
      "<!-- END GENERATED HOST CONFIGURATION -->",
      "<!-- BEGIN GENERATED STACK CONFIGURATION -->",
      renderStackVariableTable(stackVariables),
      "<!-- END GENERATED STACK CONFIGURATION -->",
    ].join("\n"),
    hostTemplate: Object.keys(serverVariables)
      .map((name) => `${name}=`)
      .join("\n"),
    stackTemplate: Object.keys(stackVariables)
      .map((name) => `${name}=`)
      .join("\n"),
    composeFile: `services:\n  app:\n    environment:\n${validComposeEnvironment(environment, omitted)}\n`,
  };
}
