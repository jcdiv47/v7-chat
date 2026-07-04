"use node";
/**
 * Postgres access as `"use node"` internal actions. The chat HTTP action runs in
 * the V8 runtime and cannot use the `pg` client, so it calls these via
 * `ctx.runAction`. This also keeps INTERMEDIATE_DATABASE_URL out of the
 * streaming endpoint. See docs/specs/01 & 03.
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { createPgExecutor } from "../../src/lib/sql/pg-executor";
import type { PostgresExecutor } from "../../src/lib/sql/executor";

function executor(): PostgresExecutor {
  const url = process.env.INTERMEDIATE_DATABASE_URL;
  if (!url) {
    throw new Error(
      "INTERMEDIATE_DATABASE_URL is not set in the Convex deployment. " +
        "Set it with `npx convex env set INTERMEDIATE_DATABASE_URL <url>`.",
    );
  }
  return createPgExecutor(url);
}

export const listTables = internalAction({
  args: {},
  handler: async () => {
    const exec = executor();
    try {
      return await exec.listTables();
    } finally {
      await exec.close();
    }
  },
});

export const describeTable = internalAction({
  args: { table: v.string() },
  handler: async (_ctx, { table }) => {
    const exec = executor();
    try {
      return await exec.describeTable(table);
    } finally {
      await exec.close();
    }
  },
});

export const runSql = internalAction({
  args: { sql: v.string(), purpose: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const exec = executor();
    try {
      return await exec.runSql(args);
    } finally {
      await exec.close();
    }
  },
});
