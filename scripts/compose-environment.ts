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

export type ComposeEnvironmentResult =
  | { environment: Map<string, string> }
  | { problem: string };

/** Read only the app service environment; this is not a general YAML parser. */
export function composeAppEnvironment(
  composeFile: string,
): ComposeEnvironmentResult {
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
