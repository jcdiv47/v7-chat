/**
 * Apply pending Drizzle migrations. Called once at boot (instrumentation.ts),
 * so a container deploy needs no separate release phase; also exposed as
 * `npm run db:migrate`. drizzle's migrator takes an advisory lock, so a
 * concurrent boot is safe.
 */
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "./client";

export async function runMigrations(): Promise<void> {
  await migrate(getDb(), {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
}
