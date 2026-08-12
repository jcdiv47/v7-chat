import {
  defineRailway,
  github,
  group,
  image,
  preserve,
  project,
  service,
  volume,
} from "railway/iac";

export default defineRailway((ctx) => {
  const appData = volume("app-db-data", { sizeMB: 10_240 });
  const appDatabase = service("app-db", {
    source: image("postgres:17-alpine"),
    deploy: { restartPolicyType: "ALWAYS" },
    env: {
      POSTGRES_USER: "v7",
      POSTGRES_DB: "v7_chat",
      POSTGRES_PASSWORD: ctx.shared.APP_DB_PASSWORD,
      DATABASE_URL:
        "postgresql://v7:${{shared.APP_DB_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:5432/v7_chat",
    },
    volumeMounts: {
      "/var/lib/postgresql/data": appData,
    },
  });

  const analyticalData = volume("intermediate-db-data", {
    sizeMB: 10_240,
  });

  // This custom Postgres image preserves the production stack's split between
  // an administrative import login and the agent's read-only query login.
  const intermediateDatabase = service("intermediate-db", {
    source: github("jcdiv47/v7-chat", {
      branch: "main",
      rootDirectory: "deploy/railway/intermediate-db",
    }),
    build: {
      watchPatterns: ["/deploy/railway/intermediate-db/**"],
    },
    deploy: { restartPolicyType: "ALWAYS" },
    env: {
      POSTGRES_USER: "intermediate_admin",
      POSTGRES_DB: "analytics",
      POSTGRES_PASSWORD: ctx.shared.INTERMEDIATE_ADMIN_PASSWORD,
      INTERMEDIATE_READONLY_PASSWORD:
        ctx.shared.INTERMEDIATE_READONLY_PASSWORD,
      READONLY_DATABASE_URL:
        "postgresql://v7_readonly:${{shared.INTERMEDIATE_READONLY_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:5432/analytics",
    },
    volumeMounts: {
      "/var/lib/postgresql/data": analyticalData,
    },
  });

  const app = service("app", {
    source: github("jcdiv47/v7-chat", { branch: "main" }),
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: 1,
    deploy: {
      drainingSeconds: 40,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    env: {
      DATABASE_URL: appDatabase.env.DATABASE_URL,
      INTERMEDIATE_DATABASE_URL:
        intermediateDatabase.env.READONLY_DATABASE_URL,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
        ctx.shared.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      CLERK_SECRET_KEY: ctx.shared.CLERK_SECRET_KEY,
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
      MODEL_PROVIDER: ctx.shared.MODEL_PROVIDER,
      OPENROUTER_API_KEY: ctx.shared.OPENROUTER_API_KEY,
      OPENROUTER_APP_URL: ctx.shared.OPENROUTER_APP_URL,
      OPENROUTER_APP_TITLE: preserve(),
      MODEL_FAST: preserve(),
      MODEL_ANALYST: preserve(),
      MODEL_SQL: preserve(),
      MODEL_SUMMARIZER: preserve(),
      MODEL_FAST_REASONING: preserve(),
      MODEL_ANALYST_REASONING: preserve(),
      MODEL_SQL_REASONING: preserve(),
      MODEL_SUMMARIZER_REASONING: preserve(),
      SQL_STATEMENT_TIMEOUT_MS: preserve(),
      SQL_MAX_ROWS: preserve(),
      SQL_MAX_RESULT_BYTES: preserve(),
      APP_VERSION: preserve(),
      LANGFUSE_PUBLIC_KEY: preserve(),
      LANGFUSE_SECRET_KEY: preserve(),
      LANGFUSE_BASE_URL: preserve(),
      LANGFUSE_ENVIRONMENT: preserve(),
      LANGFUSE_RELEASE: preserve(),
      DRAIN_GRACE_MS: preserve(),
      NEXT_MANUAL_SIG_HANDLE: "true",
    },
  });

  return project("v7-chat", {
    resources: [
      group("Application", [app, appDatabase, appData]),
      group("Analytical database", [
        intermediateDatabase,
        analyticalData,
      ]),
    ],
  });
});
