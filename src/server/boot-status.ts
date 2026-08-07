import type { ServerEnv } from "../env/parse";

type BootCapabilityStatus = {
  tracing: boolean;
  modelProvider: ServerEnv["MODEL_PROVIDER"];
  realModel: boolean;
  analyticalDatabaseConfigured: boolean;
};

/**
 * Describe the optional capabilities without exposing any configuration values.
 * Pglite is named explicitly because it is the offline database for the TUI and
 * eval runner, but it is deliberately not bundled into the Next.js web runtime.
 */
export function formatBootCapabilityStatus(status: BootCapabilityStatus): string {
  const model = status.realModel
    ? `${status.modelProvider} (real model)`
    : status.modelProvider === "mock"
      ? "mock (offline demo agent)"
      : `${status.modelProvider}, but OPENROUTER_API_KEY is not set — running the offline demo agent`;

  const analyticalDatabase = status.analyticalDatabaseConfigured
    ? "real PostgreSQL"
    : "not configured (pglite is available only to the TUI and eval runner, not the web runtime)";

  return (
    `Langfuse tracing ${status.tracing ? "on" : "off"}, ` +
    `model provider ${model}, ` +
    `analytical database ${analyticalDatabase}`
  );
}
