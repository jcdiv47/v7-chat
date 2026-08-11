type ComposeDefaultPolicy =
  | {
      defaultValue: string;
      /** Pin defaultValue in Compose instead of passing an empty value to the app. */
      pinComposeDefault: true;
    }
  | {
      defaultValue?: string;
      pinComposeDefault?: never;
    };

export type AppReachability =
  | false
  | { kind: "direct" | "derived"; description: string };

export type StackVariableDeclaration = ComposeDefaultPolicy & {
  required: boolean;
  consumer: string;
  reachesApp: AppReachability;
  notes: string;
};

export type StackVariableTable = Record<string, StackVariableDeclaration>;

const directToApp = { kind: "direct", description: "Yes" } as const;

export function describeAppReachability(
  reachability: AppReachability,
): string {
  return reachability === false ? "No" : reachability.description;
}

/**
 * Docker Compose interpolation inputs. These deliberately do not live in the
 * app environment schema because Compose consumes them before the app starts.
 */
export const stackVariables = {
  DOMAIN: {
    required: true,
    consumer: "caddy service, OPENROUTER_APP_URL",
    reachesApp: {
      kind: "derived",
      description: "Only as `https://${DOMAIN}`",
    },
    notes: "Point DNS at the host before starting Caddy; use `localhost` for rehearsal.",
  },
  ACME_EMAIL: {
    required: true,
    consumer: "caddy service",
    reachesApp: false,
    notes: "Let's Encrypt expiry notices.",
  },
  APP_DB_PASSWORD: {
    required: true,
    consumer: "app-db, DATABASE_URL assembly",
    reachesApp: {
      kind: "derived",
      description: "Only inside DATABASE_URL",
    },
    notes: "Generate with `openssl rand -hex 32`.",
  },
  INTERMEDIATE_ADMIN_PASSWORD: {
    required: true,
    consumer: "intermediate-db",
    reachesApp: false,
    notes: "Admin login used by CSV imports, never by the agent.",
  },
  INTERMEDIATE_READONLY_PASSWORD: {
    required: true,
    consumer: "init-intermediate.sh, INTERMEDIATE_DATABASE_URL assembly",
    reachesApp: {
      kind: "derived",
      description: "Only inside INTERMEDIATE_DATABASE_URL",
    },
    notes: "The agent's read-only login.",
  },
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: {
    required: true,
    consumer: "Docker build arg and app environment",
    reachesApp: directToApp,
    notes: "Changing it requires a rebuild.",
  },
  CLERK_SECRET_KEY: {
    required: true,
    consumer: "app environment",
    reachesApp: directToApp,
    notes: "Server-side Clerk credential.",
  },
  OPENROUTER_API_KEY: {
    required: false,
    defaultValue: "empty",
    consumer: "app environment",
    reachesApp: directToApp,
    notes: "Empty enables demo fallback.",
  },
  MODEL_PROVIDER: {
    required: false,
    defaultValue: "empty",
    consumer: "app environment",
    reachesApp: directToApp,
    notes: "Set `mock` for an offline demonstration.",
  },
  OPENROUTER_APP_TITLE: appSchemaPassThrough("OpenRouter attribution title."),
  MODEL_FAST: appSchemaPassThrough("Model alias override."),
  MODEL_ANALYST: appSchemaPassThrough("Model alias override."),
  MODEL_SQL: appSchemaPassThrough("Model alias override."),
  MODEL_SUMMARIZER: appSchemaPassThrough("Model alias override."),
  MODEL_FAST_REASONING: appSchemaPassThrough("Reasoning-effort override."),
  MODEL_ANALYST_REASONING: appSchemaPassThrough("Reasoning-effort override."),
  MODEL_SQL_REASONING: appSchemaPassThrough("Reasoning-effort override."),
  MODEL_SUMMARIZER_REASONING: appSchemaPassThrough("Reasoning-effort override."),
  SQL_STATEMENT_TIMEOUT_MS: appSchemaPassThrough("Per-query timeout in milliseconds."),
  SQL_MAX_ROWS: appSchemaPassThrough("Maximum rows returned by a query."),
  SQL_MAX_RESULT_BYTES: appSchemaPassThrough(
    "Maximum serialized size of a persisted table artifact.",
  ),
  DRAIN_GRACE_MS: appSchemaPassThrough("Keep below Compose's 40 second stop grace period."),
  APP_VERSION: appOptional("App version used by tracing and command-line output."),
  LANGFUSE_PUBLIC_KEY: appOptional("Tracing requires both Langfuse keys."),
  LANGFUSE_SECRET_KEY: appOptional("Tracing requires both Langfuse keys."),
  LANGFUSE_BASE_URL: appOptional("Region-specific or self-hosted Langfuse URL."),
  LANGFUSE_ENVIRONMENT: appComposeDefault("production", "Environment label on traces."),
  LANGFUSE_RELEASE: appOptional("Release label on traces."),
} satisfies StackVariableTable;

function appOptional(notes: string): StackVariableDeclaration {
  return {
    required: false,
    defaultValue: "empty",
    consumer: "app environment",
    reachesApp: directToApp,
    notes,
  };
}

function appSchemaPassThrough(notes: string): StackVariableDeclaration {
  return appOptional(`Empty falls back to the app schema. ${notes}`);
}

function appComposeDefault(
  defaultValue: string,
  notes: string,
): StackVariableDeclaration {
  return { ...appOptional(notes), defaultValue, pinComposeDefault: true };
}
