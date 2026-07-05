/**
 * tRPC scaffolding. V1 runs as a single anonymous user; V2 auth swaps
 * createContext for a session resolver (BetterAuth/Clerk) and procedures keep
 * filtering by ctx.userId unchanged. See docs/specs/11 → V2 Readiness.
 */
import { initTRPC } from "@trpc/server";
import { ANON_USER_ID } from "../constants";
import { getDb, type Db } from "../db/client";

export type Context = {
  userId: string;
  db: Db;
};

export function createContext(): Context {
  return { userId: ANON_USER_ID, db: getDb() };
}

const t = initTRPC.context<Context>().create({
  sse: {
    client: { reconnectAfterInactivityMs: 30_000 },
    ping: { enabled: true, intervalMs: 10_000 },
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
