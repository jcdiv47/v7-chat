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

function loadEnv() {
  try {
    (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(".env.local");
  } catch {
    /* ambient env */
  }
}

async function main() {
  loadEnv();
  const url = process.env.SEED_DATABASE_URL ?? process.env.INTERMEDIATE_DATABASE_URL;
  if (!url) {
    console.error("Set SEED_DATABASE_URL or INTERMEDIATE_DATABASE_URL to a writable Postgres URL.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
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
  console.error(err);
  process.exit(1);
});
