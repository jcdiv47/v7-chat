import { version as packageVersion } from "../../package.json";

const SEMVER_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function normalizeVersion(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("v")) {
    return SEMVER_VERSION.test(value.slice(1)) ? value : undefined;
  }
  return SEMVER_VERSION.test(value) ? `v${value}` : value;
}

export function getAppVersion(): string {
  return (
    normalizeVersion(env("APP_VERSION")) ??
    normalizeVersion(env("NEXT_PUBLIC_APP_VERSION")) ??
    normalizeVersion(packageVersion) ??
    "unknown"
  );
}

export function getLangfuseRelease(): string {
  return normalizeVersion(env("LANGFUSE_RELEASE")) ?? getAppVersion();
}
