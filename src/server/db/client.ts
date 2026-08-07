/**
 * App database client: one pg Pool over DATABASE_URL (private Docker-network
 * URL in production, docker-compose Postgres in dev) wrapped by Drizzle.
 * globalThis-cached so Next dev hot reloads don't leak pools.
 */
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { serverEnv } from "../../env/server";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

type DbGlobal = { pool: Pool; db: Db };

const globalStore = globalThis as unknown as { __v7AppDb?: DbGlobal };

function create(): DbGlobal {
  // DATABASE_URL is core, so `bootServer` has already validated it — reaching
  // here with it missing means a build-time render or a non-boot entry point.
  // The module's message names the variable; this one adds where to point it.
  let url: string;
  try {
    url = serverEnv().DATABASE_URL;
  } catch (err) {
    throw new Error(
      `${err instanceof Error ? err.message : String(err)}\n` +
        "Point DATABASE_URL at the app Postgres " +
        "(docker compose up -d db for dev; the app-db URL in production).",
    );
  }
  const pool = new Pool({
    connectionString: url,
    max: 10,
    application_name: "v7-chat-app",
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export function getDb(): Db {
  return (globalStore.__v7AppDb ??= create()).db;
}

export function getPool(): Pool {
  return (globalStore.__v7AppDb ??= create()).pool;
}
