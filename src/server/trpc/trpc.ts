/**
 * tRPC scaffolding. The context resolves the signed-in Clerk user; every
 * procedure filters by ctx.userId. See docs/specs/01-system-architecture.md.
 */
import { auth } from "@clerk/nextjs/server";
import { initTRPC, TRPCError } from "@trpc/server";
import { getDb, type Db } from "../db/client";

export type Context = {
  userId: string;
  db: Db;
};

export async function createContext(): Promise<Context> {
  const { userId } = await auth();
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return { userId, db: getDb() };
}

const t = initTRPC.context<Context>().create({
  sse: {
    client: { reconnectAfterInactivityMs: 30_000 },
    ping: { enabled: true, intervalMs: 10_000 },
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
