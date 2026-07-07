import packageJson from "../../package.json";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function normalizeVersion(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("v")) return value;
  return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(value) ? `v${value}` : value;
}

export function getAppVersion(): string {
  return (
    normalizeVersion(env("APP_VERSION")) ??
    normalizeVersion(env("NEXT_PUBLIC_APP_VERSION")) ??
    normalizeVersion(packageJson.version) ??
    "unknown"
  );
}

export function getLangfuseRelease(): string {
  return normalizeVersion(env("LANGFUSE_RELEASE")) ?? getAppVersion();
}
