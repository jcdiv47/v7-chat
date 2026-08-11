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
      "| `TEST_AUTO_DOCUMENTED` | tracing | No | `from-schema` | `.env.local` (development); `docker-compose.prod.yml` (production) | test consumer | Added only to the schema fixture. |",
    );
  });

  it("states which file sets variables on both surfaces", () => {
    expect(renderHostVariableTable(serverVariables)).toContain("| Set by | Read by |");
    expect(renderStackVariableTable()).toContain(
      "| Set by | Consumed by | Reaches the app? |",
    );
    expect(renderStackVariableTable()).toContain(
      "| `deploy/aws.env` or `deploy/rehearsal.env` |",
    );
  });

  it("documents the analytical database fallbacks by consumer", () => {
    const table = renderHostVariableTable(serverVariables);

    expect(table).toContain(
      "none (web agent); in-process PGlite sample database (TUI and eval runner)",
    );
    expect(table).toContain(
      "| `SEED_DATABASE_URL` | analytical-database | No (but the seed script requires this or INTERMEDIATE_DATABASE_URL) | INTERMEDIATE_DATABASE_URL |",
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

  it("reports schema defaults pinned in the host template", () => {
    const result = checkConfiguration({
      ...validInput({}),
      hostTemplate: Object.entries(serverVariables as VariableTable)
        .map(([name, declaration]) =>
          `${name}=${name === "SQL_MAX_RESULT_BYTES" ? "700000" : declaration.hostTemplateValue ?? ""}`,
        )
        .join("\n"),
    });

    expect(result.problems).toContain(
      ".env.example must set SQL_MAX_RESULT_BYTES to an empty value",
    );
  });

  it("reports defaults pinned in the stack template", () => {
    const result = checkConfiguration({
      ...validInput({}),
      stackTemplate: Object.keys(stackVariables)
        .map((name) => {
          const value =
            name === "SQL_MAX_ROWS"
              ? "500"
              : name === "LANGFUSE_ENVIRONMENT"
                ? "production"
                : "";
          return `${name}=${value}`;
        })
        .join("\n"),
    });

    expect(result.problems).toContain(
      "deploy/stack.env.example must set SQL_MAX_ROWS to an empty value",
    );
    expect(result.problems).not.toContain(
      "deploy/stack.env.example must set LANGFUSE_ENVIRONMENT to production",
    );
  });

  it("treats an inline stack-template comment as a value", () => {
    const input = validInput({});
    const result = checkConfiguration({
      ...input,
      stackTemplate: input.stackTemplate.replace(
        "SQL_MAX_ROWS=",
        "SQL_MAX_ROWS= # not empty in a Compose env file",
      ),
    });

    expect(result.problems).toContain(
      "deploy/stack.env.example must set SQL_MAX_ROWS to an empty value",
    );
  });

  it("reports optional declared variables omitted from either template", () => {
    const hostTemplate = Object.keys(serverVariables)
      .filter((name) => name !== "NEXT_PUBLIC_APP_VERSION")
      .map((name) => `${name}=`)
      .join("\n");
    const stackTemplate = Object.keys(stackVariables)
      .filter((name) => name !== "SQL_MAX_RESULT_BYTES")
      .map((name) => `${name}=`)
      .join("\n");

    const result = checkConfiguration({
      ...validInput({}),
      hostTemplate,
      stackTemplate,
    });

    expect(result.problems).toContain(
      ".env.example omits declared variable NEXT_PUBLIC_APP_VERSION",
    );
    expect(result.problems).toContain(
      "deploy/stack.env.example omits declared variable SQL_MAX_RESULT_BYTES",
    );
  });

  it.each([
    "${SQL_MAX_ROWS:-500}",
    '"${SQL_MAX_ROWS:-500}"',
    "'${SQL_MAX_ROWS:-500}'",
    "${SQL_MAX_ROWS:-500} # tune per host",
    '"${SQL_MAX_ROWS:-500}" # tune per host',
    "'${SQL_MAX_ROWS:-500}' # tune per host",
    '"${SQL_MAX_ROWS:-500 # not a YAML comment}"',
  ])("reports app-schema defaults in Compose scalar %s", (value) => {
    const result = checkConfiguration(
      validInput({ SQL_MAX_ROWS: value }),
    );

    expect(result.problems).toContain(
      "docker-compose.prod.yml pins SQL_MAX_ROWS; use ${SQL_MAX_ROWS:-} so the app schema supplies its default",
    );
  });

  it("accepts pass-throughs and a default for an app variable with no schema default", () => {
    const result = checkConfiguration(
      validInput({
        SQL_MAX_ROWS: "${SQL_MAX_ROWS:-}",
        APP_VERSION: "${APP_VERSION:-v1.2.3}",
      }),
    );

    expect(result.problems).toEqual([]);
  });

  it("reports a variable declared as reaching the app when Compose omits it", () => {
    const result = checkConfiguration(
      validInput({}, ["SQL_MAX_RESULT_BYTES"]),
    );

    expect(result.problems).toContain(
      "docker-compose.prod.yml omits SQL_MAX_RESULT_BYTES, which is declared as reaching the app",
    );
  });

  it.each([
    [
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}",
    ],
    ["CLERK_SECRET_KEY", "${CLERK_SECRET_KEY:?Set CLERK_SECRET_KEY}"],
  ])("accepts direct app interpolation %s: %s", (name, value) => {
    const result = checkConfiguration(validInput({ [name]: value }));

    expect(result.problems).toEqual([]);
  });

  it.each(["700000", "${OTHER:-}"])(
    "reports an app-reachable variable that does not interpolate itself: %s",
    (value) => {
      const result = checkConfiguration(
        validInput({ SQL_MAX_RESULT_BYTES: value }),
      );

      expect(result.problems).toContain(
        "docker-compose.prod.yml must interpolate SQL_MAX_RESULT_BYTES from its stack variable",
      );
    },
  );

  it.each([
    "${LANGFUSE_ENVIRONMENT:-staging}",
    "production",
  ])("reports one problem when a declared production default diverges: %s", (value) => {
    const result = checkConfiguration(
      validInput({ LANGFUSE_ENVIRONMENT: value }),
    );

    expect(result.problems).toEqual([
      "docker-compose.prod.yml must pin LANGFUSE_ENVIRONMENT to its declared production default production",
    ]);
  });

  it("ignores assembled and fixed Compose values", () => {
    const result = checkConfiguration(
      validInput({
        DATABASE_URL:
          "postgresql://v7:${APP_DB_PASSWORD}@app-db:5432/v7_chat",
        OPENROUTER_APP_URL: "https://${DOMAIN}",
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
        NEXT_MANUAL_SIG_HANDLE: '"true"',
      }),
    );

    expect(result.problems).toEqual([]);
  });

  it("reports every drifted Compose default in one pass", () => {
    const result = checkConfiguration(
      validInput({
        SQL_MAX_ROWS: "${SQL_MAX_ROWS:-500}",
        DRAIN_GRACE_MS: "${DRAIN_GRACE_MS:-25000}",
      }),
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
    const result = checkConfiguration({ ...validInput({}), composeFile });

    expect(result.problems).toContain(
      "could not locate the app service environment in docker-compose.prod.yml",
    );
  });

  it("accepts nonstandard but valid indentation", () => {
    const environment = validComposeEnvironment({})
      .split("\n")
      .map((line) => `            ${line.trimStart()}`)
      .join("\n");
    const result = checkConfiguration({
      ...validInput({}),
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
  overrides: Record<string, string>,
  omitted: string[] = [],
): string {
  const omittedNames = new Set(omitted);
  const stackDeclarations: StackVariableTable = stackVariables;
  const environment = new Map(
    Object.entries(stackDeclarations)
      .filter(
        ([name, declaration]) =>
          declaration.reachesApp !== false &&
          declaration.reachesApp.kind === "direct" &&
          !omittedNames.has(name),
      )
      .map(([name, declaration]) => [
        name,
        `\${${name}:-${declaration.pinComposeDefault ? declaration.defaultValue : ""}}`,
      ]),
  );
  for (const [name, value] of Object.entries(overrides)) {
    environment.set(name, value);
  }
  return [...environment]
    .map(([name, value]) => `      ${name}: ${value}`)
    .join("\n");
}

function validInput(
  overrides: Record<string, string>,
  omitted: string[] = [],
) {
  const stackDeclarations: StackVariableTable = stackVariables;
  return {
    document: [
      "<!-- BEGIN GENERATED HOST CONFIGURATION -->",
      renderHostVariableTable(serverVariables),
      "<!-- END GENERATED HOST CONFIGURATION -->",
      "<!-- BEGIN GENERATED STACK CONFIGURATION -->",
      renderStackVariableTable(stackVariables),
      "<!-- END GENERATED STACK CONFIGURATION -->",
    ].join("\n"),
    hostTemplate: Object.entries(serverVariables as VariableTable)
      .map(([name, declaration]) =>
        `${name}=${declaration.hostTemplateValue ?? ""}`,
      )
      .join("\n"),
    stackTemplate: Object.entries(stackDeclarations)
      .map(([name, declaration]) =>
        `${name}=${declaration.pinComposeDefault ? declaration.defaultValue : ""}`,
      )
      .join("\n"),
    composeFile: `services:\n  app:\n    environment:\n${validComposeEnvironment(overrides, omitted)}\n`,
  };
}
