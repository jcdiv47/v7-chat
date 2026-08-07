/**
 * The authoritative declaration of every environment variable this project
 * reads. See docs/configuration.md for the prose reference; this file is the
 * machine-readable half of it.
 *
 * Each variable is declared once, with:
 *
 * - `capability` — the layer it belongs to. Core variables are the ones without
 *   which the server cannot serve at all; the rest belong to a capability that
 *   may legitimately be absent. This ticket only *declares* the tags; nothing
 *   enforces them yet.
 * - `schema` — a Zod schema, carrying the default via `.default()` where the
 *   variable has one, so that no call site has to repeat a fallback value.
 * - `secret` — whether the value must be redacted in error output. The primary
 *   consumer of a validation failure is a deploy log.
 * - `consumer` — which component reads it.
 * - `expectation` — a human phrase completing "expected …", used verbatim in
 *   error output so the message does not depend on Zod's wording.
 *
 * Deliberately absent: `NEXT_RUNTIME`, `NODE_ENV`, `PORT`, `HOSTNAME` and
 * `NEXT_TELEMETRY_DISABLED`. Those are platform-provided values rather than app
 * configuration, and their readers (Next.js, `src/instrumentation.ts`) keep
 * reading them directly. Compose interpolation inputs (`DOMAIN`, `ACME_EMAIL`,
 * the database passwords) are absent for the same reason: they never reach the
 * app process. See docs/configuration.md → "The two surfaces".
 */
import { z } from "zod";

/** The layers of validation. Core is eager at boot; the rest are per-capability. */
export type Capability =
  | "core"
  | "model-provider"
  | "analytical-database"
  | "tracing"
  | "lifecycle";

export type Declaration<S extends z.ZodType = z.ZodType> = {
  capability: Capability;
  schema: S;
  /** Redact the value in error output. */
  secret: boolean;
  /** Which component reads it. */
  consumer: string;
  /** Completes "expected …" in a problem line. */
  expectation: string;
};

export type VariableTable = Record<string, Declaration>;

/** Postgres connection strings, checked as parseable URLs so that a truncated
 * paste fails here rather than as a driver error minutes later. A host is
 * required: `new URL` happily accepts `postgres://` and `postgres:/user@host/db`
 * — the two shapes a bad paste actually produces — and both have none. */
const postgresUrl = () =>
  z.string().refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const scheme = url.protocol === "postgres:" || url.protocol === "postgresql:";
    return scheme && url.hostname.length > 0;
  });

const httpUrl = () =>
  z.string().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });

/** Numeric variables are uniformly positive, finite integers — the drain window
 * is validated as carefully as the SQL timeout. */
const positiveInt = () =>
  z.coerce
    .number()
    .refine(Number.isFinite)
    .refine((value) => Number.isInteger(value) && value > 0);

export const reasoningEfforts = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export const modelProviders = ["openrouter", "mock"] as const;

const reasoning = () => z.enum(reasoningEfforts).default("low");

const REASONING_EXPECTATION = `one of: ${reasoningEfforts.join(", ")}`;

/**
 * The `NEXT_PUBLIC_*` surface. Declared separately because it is the only part
 * of the schema a client component may reach, and because Next.js inlines these
 * at build time — see src/env/public.ts for why that constrains how they are
 * read.
 */
export const publicVariables = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: {
    capability: "core",
    schema: z.string(),
    secret: false,
    consumer: "Clerk SDK (clerkMiddleware in src/proxy.ts, React providers)",
    expectation: "a Clerk publishable key",
  },
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: {
    capability: "core",
    schema: z.string().default("/sign-in"),
    secret: false,
    consumer: "Clerk SDK",
    expectation: "a path to the sign-in page",
  },
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: {
    capability: "core",
    schema: z.string().default("/sign-up"),
    secret: false,
    consumer: "Clerk SDK",
    expectation: "a path to the sign-up page",
  },
  NEXT_PUBLIC_APP_VERSION: {
    capability: "tracing",
    schema: z.string().optional(),
    secret: false,
    consumer: "src/lib/app-version.ts",
    expectation: "a version string",
  },
} satisfies VariableTable;

/**
 * Everything the server reads, including the public variables (the server sees
 * those too). Grouped by capability, in the order docs/configuration.md uses.
 */
export const serverVariables = {
  // --- Core: the server cannot serve without these -----------------------
  DATABASE_URL: {
    capability: "core",
    schema: postgresUrl(),
    secret: true,
    consumer: "src/server/db/client.ts, drizzle.config.ts",
    expectation: "a Postgres connection URL (postgres:// or postgresql://)",
  },
  CLERK_SECRET_KEY: {
    capability: "core",
    schema: z.string(),
    secret: true,
    consumer: "Clerk SDK (server)",
    expectation: "a Clerk secret key",
  },
  ...publicVariables,

  // --- Model provider ----------------------------------------------------
  // Defaulting to `openrouter` rather than leaving it unset is deliberate: it
  // makes the parsed value non-optional without changing meaning, since every
  // reader today only asks whether the value is `mock`.
  MODEL_PROVIDER: {
    capability: "model-provider",
    schema: z.enum(modelProviders).default("openrouter"),
    secret: false,
    consumer: "src/lib/models/registry.ts",
    expectation: `one of: ${modelProviders.join(", ")}`,
  },
  OPENROUTER_API_KEY: {
    capability: "model-provider",
    schema: z.string().optional(),
    secret: true,
    consumer: "src/lib/models/registry.ts",
    expectation: "an OpenRouter API key",
  },
  OPENROUTER_APP_URL: {
    capability: "model-provider",
    schema: httpUrl().default("http://localhost:3000"),
    secret: false,
    consumer: "src/lib/models/registry.ts (HTTP-Referer attribution header)",
    expectation: "an http:// or https:// URL",
  },
  OPENROUTER_APP_TITLE: {
    capability: "model-provider",
    schema: z.string().default("v7 Business Analyst"),
    secret: false,
    consumer: "src/lib/models/registry.ts (X-Title attribution header)",
    expectation: "a title string",
  },

  // The model registry builds these names dynamically today, so none of them
  // appears as a literal `process.env.X` anywhere. Declaring them here is what
  // makes searching for `MODEL_ANALYST` find something.
  MODEL_FAST: {
    capability: "model-provider",
    schema: z.string().default("openai/gpt-oss-120b:nitro"),
    secret: false,
    consumer: "src/lib/models/registry.ts",
    expectation: "an OpenRouter model ID for the `fast` alias",
  },
  MODEL_ANALYST: {
    capability: "model-provider",
    schema: z.string().default("z-ai/glm-5.2:nitro"),
    secret: false,
    consumer: "src/lib/models/registry.ts",
    expectation: "an OpenRouter model ID for the `analyst` alias",
  },
  MODEL_SQL: {
    capability: "model-provider",
    schema: z.string().default("moonshotai/kimi-k2.6"),
    secret: false,
    consumer: "src/lib/models/registry.ts",
    expectation: "an OpenRouter model ID for the `sql` alias",
  },
  MODEL_SUMMARIZER: {
    capability: "model-provider",
    schema: z.string().default("openai/gpt-oss-120b:nitro"),
    secret: false,
    consumer: "src/lib/models/registry.ts",
    expectation: "an OpenRouter model ID for the `summarizer` alias",
  },
  MODEL_FAST_REASONING: {
    capability: "model-provider",
    schema: reasoning(),
    secret: false,
    consumer: "src/lib/models/registry.ts",
    expectation: REASONING_EXPECTATION,
  },
  MODEL_ANALYST_REASONING: {
    capability: "model-provider",
    schema: reasoning(),
    secret: false,
    consumer: "src/lib/models/registry.ts",
    expectation: REASONING_EXPECTATION,
  },
  MODEL_SQL_REASONING: {
    capability: "model-provider",
    schema: reasoning(),
    secret: false,
    consumer: "src/lib/models/registry.ts",
    expectation: REASONING_EXPECTATION,
  },
  MODEL_SUMMARIZER_REASONING: {
    capability: "model-provider",
    schema: reasoning(),
    secret: false,
    consumer: "src/lib/models/registry.ts",
    expectation: REASONING_EXPECTATION,
  },

  // --- Analytical (intermediate) database --------------------------------
  INTERMEDIATE_DATABASE_URL: {
    capability: "analytical-database",
    schema: postgresUrl().optional(),
    secret: true,
    consumer: "src/server/worker-deps.ts, scripts/seed-db.ts",
    expectation: "a Postgres connection URL (postgres:// or postgresql://)",
  },
  SEED_DATABASE_URL: {
    capability: "analytical-database",
    schema: postgresUrl().optional(),
    secret: true,
    consumer: "scripts/seed-db.ts",
    expectation: "a writable Postgres connection URL",
  },
  SQL_STATEMENT_TIMEOUT_MS: {
    capability: "analytical-database",
    schema: positiveInt().default(10_000),
    secret: false,
    consumer: "src/lib/sql/executor.ts",
    expectation: "a positive whole number of milliseconds",
  },
  SQL_MAX_ROWS: {
    capability: "analytical-database",
    schema: positiveInt().default(500),
    secret: false,
    consumer: "src/lib/sql/executor.ts",
    expectation: "a positive whole number of rows",
  },
  SQL_MAX_RESULT_BYTES: {
    capability: "analytical-database",
    schema: positiveInt().default(700_000),
    secret: false,
    consumer: "src/lib/sql/executor.ts",
    expectation: "a positive whole number of bytes",
  },

  // --- Version and tracing -----------------------------------------------
  APP_VERSION: {
    capability: "tracing",
    schema: z.string().optional(),
    secret: false,
    consumer: "src/lib/app-version.ts",
    expectation: "a version string",
  },
  LANGFUSE_PUBLIC_KEY: {
    capability: "tracing",
    schema: z.string().optional(),
    secret: false,
    consumer: "src/server/telemetry.ts",
    expectation: "a Langfuse public key",
  },
  LANGFUSE_SECRET_KEY: {
    capability: "tracing",
    schema: z.string().optional(),
    secret: true,
    consumer: "src/server/telemetry.ts",
    expectation: "a Langfuse secret key",
  },
  LANGFUSE_BASE_URL: {
    capability: "tracing",
    schema: httpUrl().optional(),
    secret: false,
    consumer: "src/server/telemetry.ts",
    expectation: "an http:// or https:// URL",
  },
  LANGFUSE_ENVIRONMENT: {
    capability: "tracing",
    schema: z.string().optional(),
    secret: false,
    consumer: "src/server/telemetry.ts",
    expectation: "an environment label",
  },
  LANGFUSE_RELEASE: {
    capability: "tracing",
    schema: z.string().optional(),
    secret: false,
    consumer: "src/lib/app-version.ts",
    expectation: "a release label",
  },

  // --- Process lifecycle --------------------------------------------------
  DRAIN_GRACE_MS: {
    capability: "lifecycle",
    schema: positiveInt().default(25_000),
    secret: false,
    consumer: "src/server/sweeper.ts",
    expectation: "a positive whole number of milliseconds",
  },
  NEXT_MANUAL_SIG_HANDLE: {
    capability: "lifecycle",
    schema: z.string().optional(),
    secret: false,
    consumer: "Next.js (set by the Dockerfile and docker-compose.prod.yml)",
    expectation: "a truthy string enabling the app's own SIGTERM handler",
  },
} satisfies VariableTable;

export type ServerVariableName = keyof typeof serverVariables;
export type PublicVariableName = keyof typeof publicVariables;
