/**
 * Seed a real Postgres database with the sample cities/malls/stores data, for
 * local testing of the web app against a real intermediate database.
 *
 *   SEED_DATABASE_URL=postgres://user:pw@host:5432/db npm run seed
 *
 * Uses SEED_DATABASE_URL (a writable admin connection) if set, otherwise
 * INTERMEDIATE_DATABASE_URL. The app itself should use a *read-only* role.
 */
import { Client } from "pg";
import { DATA_SQL, SCHEMA_SQL } from "../src/lib/sql/seed";
import { loadSeedEnv } from "../src/env/node";

async function main() {
  // The SEED_DATABASE_URL → INTERMEDIATE_DATABASE_URL precedence is declared in
  // src/env/variables.ts (`seedDatabaseUrlChain`), not decided here.
  const { seedDatabaseUrl } = loadSeedEnv();
  const client = new Client({ connectionString: seedDatabaseUrl });
  await client.connect();
  try {
    await client.query(SCHEMA_SQL);
    await client.query(DATA_SQL);
    const cities = await client.query("select count(*)::int n from aiqa.cities");
    const malls = await client.query("select count(*)::int n from aiqa.malls");
    const stores = await client.query("select count(*)::int n from aiqa.stores");
    console.log(
      `Seeded: ${cities.rows[0].n} cities, ${malls.rows[0].n} malls, ${stores.rows[0].n} stores.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // The message, not the object: a configuration problem is a list of lines an
  // operator should act on, and a stack trace through the env module buries it.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
