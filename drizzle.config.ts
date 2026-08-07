import { defineConfig } from "drizzle-kit";
import { drizzleDatabaseUrl } from "./src/env/node";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Validated, and defaulted to the dev database by the schema rather than by a
  // second copy of the URL here — see DEV_DATABASE_URL in src/env/variables.ts.
  dbCredentials: {
    url: drizzleDatabaseUrl(),
  },
});
