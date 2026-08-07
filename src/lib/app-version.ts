import { version as packageVersion } from "../../package.json";
import { capabilityEnv } from "../env/capabilities";

const SEMVER_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function normalizeVersion(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("v")) {
    return SEMVER_VERSION.test(value.slice(1)) ? value : undefined;
  }
  return SEMVER_VERSION.test(value) ? `v${value}` : value;
}

export function getAppVersion(): string {
  const env = capabilityEnv();
  return (
    normalizeVersion(env.APP_VERSION) ??
    normalizeVersion(env.NEXT_PUBLIC_APP_VERSION) ??
    normalizeVersion(packageVersion) ??
    "unknown"
  );
}

export function getLangfuseRelease(): string {
  return normalizeVersion(capabilityEnv().LANGFUSE_RELEASE) ?? getAppVersion();
}
