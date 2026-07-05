/**
 * One-time server boot, called from instrumentation.ts when the Next.js Node
 * process starts: apply migrations, start the stale-run sweeper, and hook
 * SIGTERM/SIGINT for the deploy drain. globalThis-guarded so dev HMR
 * re-imports don't double-boot.
 */
import { runMigrations } from "./db/migrate";
import { startSweeper, drainAndExit } from "./sweeper";

const globalStore = globalThis as unknown as { __v7Booted?: boolean };

export async function bootServer(): Promise<void> {
  if (globalStore.__v7Booted) return;
  globalStore.__v7Booted = true;

  await runMigrations();
  startSweeper();

  process.once("SIGTERM", () => void drainAndExit("SIGTERM"));
  process.once("SIGINT", () => void drainAndExit("SIGINT"));

  console.log("[boot] migrations applied, sweeper started");
}
