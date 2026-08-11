import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { serverVariables, type VariableTable } from "../src/env/variables";
import {
  stackVariables,
  type StackVariableTable,
} from "./configuration-stack";

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
    return `| ${code(name)} | ${markdown(declaration.capability)} | ${markdown(documentedRequirement)} | ${markdown(documentedDefault)} | ${markdown(declaration.consumer)} | ${markdown(declaration.notes ?? declaration.expectation)} |`;
  });

  return [
    "| Variable | Capability | Required | Default | Read by | Notes |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** Render Compose-only interpolation inputs from their separate declaration. */
export function renderStackVariableTable(
  declarations: StackVariableTable = stackVariables,
): string {
  const rows = Object.entries(declarations).map(([name, declaration]) =>
    `| ${code(name)} | stack | ${declaration.required ? "Yes" : "No"} | ${declaration.defaultValue === undefined ? "none" : code(declaration.defaultValue)} | ${markdown(declaration.consumer)} | ${markdown(declaration.reachesApp)} | ${markdown(declaration.notes)} |`,
  );
  return [
    "| Variable | Capability | Required | Default | Consumed by | Reaches the app? | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- |",
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

function templateVariables(template: string): Set<string> {
  const names = new Set<string>();
  for (const line of template.split("\n")) {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

function requiredHostVariables(table: VariableTable): string[] {
  return Object.entries(table)
    .filter(([, declaration]) => schemaRequirementAndDefault(declaration).required)
    .map(([name]) => name);
}

function indentOf(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function childIndex(
  lines: string[],
  parentIndex: number,
  key: string,
): number | undefined {
  const parentIndent = indentOf(lines[parentIndex] ?? "");
  let childIndent: number | undefined;
  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = indentOf(line);
    if (indent <= parentIndent) break;
    childIndent ??= indent;
    if (indent === childIndent && line.trim() === `${key}:`) return index;
  }
  return undefined;
}

function stripYamlComment(value: string): string {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === "'" && character === "'") {
      if (value[index + 1] === "'") index += 1;
      else quote = undefined;
    } else if (quote === '"' && character === "\\") {
      index += 1;
    } else if (quote === '"' && character === '"') {
      quote = undefined;
    } else if (!quote && (character === "'" || character === '"')) {
      quote = character;
    } else if (
      !quote &&
      character === "#" &&
      (index === 0 || /\s/.test(value[index - 1] ?? ""))
    ) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function normalizeYamlScalar(value: string): string {
  const uncommented = stripYamlComment(value);
  const quote = uncommented[0];
  return uncommented.length >= 2 &&
    (quote === '"' || quote === "'") &&
    uncommented.at(-1) === quote
    ? uncommented.slice(1, -1)
    : uncommented;
}

type ComposeEnvironmentResult =
  | { environment: Map<string, string> }
  | { problem: string };

/** Scan only the app service's environment block; no YAML features are needed. */
function composeAppEnvironment(composeFile: string): ComposeEnvironmentResult {
  const problem =
    "could not locate the app service environment in docker-compose.prod.yml";
  const lines = composeFile.split("\n");
  const servicesIndex = lines.findIndex((line) => /^services:\s*$/.test(line));
  if (servicesIndex < 0) return { problem };
  const appIndex = childIndex(lines, servicesIndex, "app");
  if (appIndex === undefined) return { problem };
  const environmentIndex = childIndex(lines, appIndex, "environment");
  if (environmentIndex === undefined) return { problem };

  const environmentIndent = indentOf(lines[environmentIndex] ?? "");
  const environment = new Map<string, string>();
  for (let index = environmentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (indentOf(line) <= environmentIndent) break;
    const entry = line.match(/^\s*([A-Z][A-Z0-9_]*):\s*(.*?)\s*$/);
    if (entry?.[1] && entry[2] !== undefined) {
      environment.set(entry[1], normalizeYamlScalar(entry[2]));
    }
  }
  return { environment };
}

function composeDefaultProblems(
  environment: Map<string, string>,
): string[] {
  const problems: string[] = [];
  const declarations: StackVariableTable = stackVariables;
  for (const [name, declaration] of Object.entries(declarations)) {
    if (!declaration.pinComposeDefault) continue;
    const expected = `\${${name}:-${declaration.defaultValue}}`;
    if (environment.get(name) !== expected) {
      problems.push(
        `docker-compose.prod.yml must pin ${name} to its declared production default ${declaration.defaultValue}`,
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

/** Check committed output and ensure templates expose every required input. */
export function checkConfiguration(input: ConfigurationCheckInput): {
  problems: string[];
} {
  const problems: string[] = [];
  if (replaceGeneratedTables(input.document) !== input.document) {
    problems.push(
      "docs/configuration.md is stale; run npm run config:generate",
    );
  }

  const hostNames = templateVariables(input.hostTemplate);
  for (const name of requiredHostVariables(serverVariables)) {
    if (!hostNames.has(name)) {
      problems.push(`.env.example omits required variable ${name}`);
    }
  }

  const stackNames = templateVariables(input.stackTemplate);
  for (const [name, declaration] of Object.entries(stackVariables)) {
    if (declaration.required && !stackNames.has(name)) {
      problems.push(
        `deploy/stack.env.example omits required variable ${name}`,
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
