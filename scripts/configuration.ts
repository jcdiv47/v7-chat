import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { serverVariables, type VariableTable } from "../src/env/variables";
import {
  describeAppReachability,
  stackVariables,
  type StackVariableTable,
} from "./configuration-stack";
import { composeAppEnvironment } from "./compose-environment";

const HOST_START = "<!-- BEGIN GENERATED HOST CONFIGURATION -->";
const HOST_END = "<!-- END GENERATED HOST CONFIGURATION -->";
const STACK_START = "<!-- BEGIN GENERATED STACK CONFIGURATION -->";
const STACK_END = "<!-- END GENERATED STACK CONFIGURATION -->";

function markdown(value: unknown): string {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function code(value: unknown): string {
  return `\`${markdown(value)}\``;
}

function schemaRequirementAndDefault(declaration: VariableTable[string]): {
  required: boolean;
  hasDefault: boolean;
  defaultValue: string;
} {
  const absent = declaration.schema.safeParse(undefined);
  if (!absent.success) {
    return { required: true, hasDefault: false, defaultValue: "none" };
  }
  if (absent.data === undefined) {
    return { required: false, hasDefault: false, defaultValue: "none" };
  }
  return {
    required: false,
    hasDefault: true,
    defaultValue: String(absent.data),
  };
}

/** Render the app schema as the host-process configuration table. */
export function renderHostVariableTable(
  declarations: VariableTable = serverVariables,
): string {
  const rows = Object.entries(declarations).map(([name, declaration]) => {
    const { required, defaultValue } = schemaRequirementAndDefault(declaration);
    const documentedRequirement =
      declaration.documentedRequirement ?? (required ? "Yes" : "No");
    const documentedDefault =
      declaration.documentedDefault ??
      (defaultValue === "none" ? "none" : code(defaultValue));
    const documentedSource =
      declaration.documentedSource ??
      "`.env.local` (development); `docker-compose.prod.yml` (production)";
    return `| ${code(name)} | ${markdown(declaration.capability)} | ${markdown(documentedRequirement)} | ${markdown(documentedDefault)} | ${markdown(documentedSource)} | ${markdown(declaration.consumer)} | ${markdown(declaration.notes ?? declaration.expectation)} |`;
  });

  return [
    "| Variable | Capability | Required | Default | Set by | Read by | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** Render Compose-only interpolation inputs from their separate declaration. */
export function renderStackVariableTable(
  declarations: StackVariableTable = stackVariables,
): string {
  const rows = Object.entries(declarations).map(([name, declaration]) =>
    `| ${code(name)} | stack | ${declaration.required ? "Yes" : "No"} | ${declaration.defaultValue === undefined ? "none" : code(declaration.defaultValue)} | ${code("deploy/aws.env")} or ${code("deploy/rehearsal.env")} | ${markdown(declaration.consumer)} | ${markdown(describeAppReachability(declaration.reachesApp))} | ${markdown(declaration.notes)} |`,
  );
  return [
    "| Variable | Capability | Required | Default | Set by | Consumed by | Reaches the app? | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function replaceRegion(
  document: string,
  startMarker: string,
  endMarker: string,
  generated: string,
): string {
  const start = document.indexOf(startMarker);
  const end = document.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(
      `Configuration reference must contain ${startMarker} before ${endMarker}`,
    );
  }
  const contentStart = start + startMarker.length;
  return `${document.slice(0, contentStart)}\n${generated}\n${document.slice(end)}`;
}

/** Replace generated tables while leaving every byte outside the markers alone. */
export function replaceGeneratedTables(document: string): string {
  const withHost = replaceRegion(
    document,
    HOST_START,
    HOST_END,
    renderHostVariableTable(),
  );
  return replaceRegion(
    withHost,
    STACK_START,
    STACK_END,
    renderStackVariableTable(),
  );
}

function templateEnvironment(template: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of template.split("\n")) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match?.[1] || match[2] === undefined) continue;
    values.set(match[1], match[2].trim());
  }
  return values;
}

function hostTemplateVariables(table: VariableTable): [string, VariableTable[string]][] {
  return Object.entries(table).filter(
    ([, declaration]) => declaration.hostTemplate !== false,
  );
}

function directlyInterpolates(name: string, value: string): boolean {
  if (value === `\${${name}}`) return true;

  const defaultPrefix = `\${${name}:-`;
  const requiredPrefix = `\${${name}:?`;
  const operatorPrefix = value.startsWith(defaultPrefix)
    ? defaultPrefix
    : value.startsWith(requiredPrefix)
      ? requiredPrefix
      : undefined;
  return (
    operatorPrefix !== undefined &&
    value.endsWith("}") &&
    !value.slice(operatorPrefix.length, -1).includes("}")
  );
}

function composeDefaultProblems(
  environment: Map<string, string>,
): string[] {
  const problems: string[] = [];
  const declarations: StackVariableTable = stackVariables;
  for (const [name, declaration] of Object.entries(declarations)) {
    const composeValue = environment.get(name);
    if (declaration.pinComposeDefault) {
      const expected = `\${${name}:-${declaration.defaultValue}}`;
      if (composeValue !== expected) {
        problems.push(
          `docker-compose.prod.yml must pin ${name} to its declared production default ${declaration.defaultValue}`,
        );
      }
      continue;
    }
    if (
      declaration.reachesApp === false ||
      declaration.reachesApp.kind !== "direct"
    ) continue;
    if (composeValue === undefined) {
      problems.push(
        `docker-compose.prod.yml omits ${name}, which is declared as reaching the app`,
      );
    } else if (!directlyInterpolates(name, composeValue)) {
      problems.push(
        `docker-compose.prod.yml must interpolate ${name} from its stack variable`,
      );
    }
  }

  for (const [name, value] of environment) {
    const interpolation = value.match(/^\$\{([A-Z][A-Z0-9_]*):-([^}]*)\}$/);
    if (!interpolation || interpolation[1] !== name || interpolation[2] === "") {
      continue;
    }
    if (declarations[name]?.pinComposeDefault) continue;

    const appDeclaration = (serverVariables as VariableTable)[name];
    if (appDeclaration && schemaRequirementAndDefault(appDeclaration).hasDefault) {
      problems.push(
        `docker-compose.prod.yml pins ${name}; use \${${name}:-} so the app schema supplies its default`,
      );
    } else {
      problems.push(
        `docker-compose.prod.yml pins ${name} without a declared production default; use \${${name}:-} or declare the override in scripts/configuration-stack.ts`,
      );
    }
  }
  return problems;
}

export type ConfigurationCheckInput = {
  document: string;
  hostTemplate: string;
  stackTemplate: string;
  composeFile: string;
};

/** Check committed output and ensure templates expose every configurable input. */
export function checkConfiguration(input: ConfigurationCheckInput): {
  problems: string[];
} {
  const problems: string[] = [];
  try {
    if (replaceGeneratedTables(input.document) !== input.document) {
      problems.push(
        "docs/configuration.md is stale; run npm run config:generate",
      );
    }
  } catch {
    problems.push(
      "docs/configuration.md must contain valid generated configuration markers",
    );
  }

  const hostEnvironment = templateEnvironment(input.hostTemplate);
  for (const [name, declaration] of hostTemplateVariables(serverVariables)) {
    if (!hostEnvironment.has(name)) {
      const qualifier = schemaRequirementAndDefault(declaration).required
        ? "required "
        : "declared ";
      problems.push(`.env.example omits ${qualifier}variable ${name}`);
      continue;
    }
    const expected = declaration.hostTemplateValue ?? "";
    if (
      (schemaRequirementAndDefault(declaration).hasDefault ||
        declaration.hostTemplateValue !== undefined) &&
      hostEnvironment.get(name) !== expected
    ) {
      problems.push(
        `.env.example must set ${name} to ${expected || "an empty value"}`,
      );
    }
  }

  const stackEnvironment = templateEnvironment(input.stackTemplate);
  const stackDeclarations: StackVariableTable = stackVariables;
  for (const [name, declaration] of Object.entries(stackDeclarations)) {
    if (!stackEnvironment.has(name)) {
      const qualifier = declaration.required ? "required " : "declared ";
      problems.push(
        `deploy/stack.env.example omits ${qualifier}variable ${name}`,
      );
      continue;
    }
    if (declaration.required) continue;
    const expected = declaration.pinComposeDefault
      ? declaration.defaultValue
      : "";
    if (stackEnvironment.get(name) !== expected) {
      problems.push(
        `deploy/stack.env.example must set ${name} to ${expected || "an empty value"}`,
      );
    }
  }

  const composeEnvironment = composeAppEnvironment(input.composeFile);
  if ("problem" in composeEnvironment) {
    problems.push(composeEnvironment.problem);
  } else {
    problems.push(...composeDefaultProblems(composeEnvironment.environment));
  }
  return { problems };
}

async function readInputs(root: string): Promise<ConfigurationCheckInput> {
  const [document, hostTemplate, stackTemplate, composeFile] =
    await Promise.all([
      readFile(resolve(root, "docs/configuration.md"), "utf8"),
      readFile(resolve(root, ".env.example"), "utf8"),
      readFile(resolve(root, "deploy/stack.env.example"), "utf8"),
      readFile(resolve(root, "docker-compose.prod.yml"), "utf8"),
    ]);
  return { document, hostTemplate, stackTemplate, composeFile };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const mode = process.argv[2];
  const input = await readInputs(root);
  if (mode === "--write") {
    await writeFile(
      resolve(root, "docs/configuration.md"),
      replaceGeneratedTables(input.document),
    );
    return;
  }
  if (mode === "--check") {
    const { problems } = checkConfiguration(input);
    if (problems.length > 0) {
      console.error(problems.join("\n"));
      process.exitCode = 1;
    }
    return;
  }
  throw new Error("Usage: tsx scripts/configuration.ts --write|--check");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
