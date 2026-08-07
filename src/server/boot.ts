/**
 * One-time server boot, called from instrumentation.ts when the Next.js Node
 * process starts: validate configuration, apply migrations, start the stale-run
 * sweeper, and hook SIGTERM/SIGINT for the deploy drain. globalThis-guarded so
 * dev HMR re-imports don't double-boot.
 */
import { serverEnv } from "../env/server";
import { hasRealModel } from "../lib/models/registry";
import { runMigrations } from "./db/migrate";
import { getDb } from "./db/client";
import { backfillThreadTitleSearchTerms } from "./search/title-index";
import { startSweeper, drainAndExit } from "./sweeper";
import { initTelemetry } from "./telemetry";

const globalStore = globalThis as unknown as { __v7Booted?: boolean };

export async function bootServer(): Promise<void> {
  if (globalStore.__v7Booted) return;
  globalStore.__v7Booted = true;

  // First, before anything touches a database: every core variable, and the
  // shape of every other one that is set. Throwing here lists all the problems
  // at once, so a misconfigured deploy is one fix rather than a sequence of
  // restarts — and the process dies rather than connecting to Postgres with a
  // URL that was never going to work.
  const env = serverEnv();

  // Then the Langfuse integration, which must be registered before the first
  // ToolLoopAgent run starts.
  const tracing = initTelemetry();

  await runMigrations();
  const indexedTitles = await backfillThreadTitleSearchTerms(getDb());
  startSweeper();

  process.once("SIGTERM", () => void drainAndExit("SIGTERM"));
  process.once("SIGINT", () => void drainAndExit("SIGINT"));

  // Which optional capabilities came up, stated once. Every one of these can
  // legitimately be off, so "the agent is not answering" needs a line saying
  // which of them this process actually has.
  //
  // The model line names the configured provider *and* what runs, because those
  // disagree in the case worth catching: MODEL_PROVIDER=openrouter with no key
  // falls back to the demo agent, which looks like a working deploy answering
  // nonsense. "openrouter, but no key — running the offline demo agent" is the
  // one line that explains it.
  const model = hasRealModel()
    ? env.MODEL_PROVIDER
    : env.MODEL_PROVIDER === "mock"
      ? "mock (offline demo agent)"
      : `${env.MODEL_PROVIDER}, but OPENROUTER_API_KEY is not set — running the offline demo agent`;

  console.log(
    `[boot] migrations applied, indexed ${indexedTitles} missing thread titles, ` +
      `sweeper started, Langfuse tracing ${tracing ? "on" : "off"}, ` +
      `model provider ${model}, ` +
      `analytical database ${env.INTERMEDIATE_DATABASE_URL ? "configured" : "not configured"}`,
  );
}
