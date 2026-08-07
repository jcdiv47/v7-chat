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
  defaultValue: string;
} {
  const absent = declaration.schema.safeParse(undefined);
  if (!absent.success) return { required: true, defaultValue: "none" };
  if (absent.data === undefined) return { required: false, defaultValue: "none" };
  return { required: false, defaultValue: String(absent.data) };
}

/** Render the app schema as the host-process configuration table. */
export function renderHostVariableTable(
  declarations: VariableTable = serverVariables,
): string {
  const rows = Object.entries(declarations).map(([name, declaration]) => {
    const { required, defaultValue } = schemaRequirementAndDefault(declaration);
    return `| ${code(name)} | ${markdown(declaration.capability)} | ${required ? "Yes" : "No"} | ${defaultValue === "none" ? "none" : code(defaultValue)} | ${markdown(declaration.consumer)} | ${markdown(declaration.notes ?? declaration.expectation)} |`;
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

export type ConfigurationCheckInput = {
  document: string;
  hostTemplate: string;
  stackTemplate: string;
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
  return { problems };
}

async function readInputs(root: string): Promise<ConfigurationCheckInput> {
  const [document, hostTemplate, stackTemplate] = await Promise.all([
    readFile(resolve(root, "docs/configuration.md"), "utf8"),
    readFile(resolve(root, ".env.example"), "utf8"),
    readFile(resolve(root, "deploy/stack.env.example"), "utf8"),
  ]);
  return { document, hostTemplate, stackTemplate };
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
