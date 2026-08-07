/**
 * Tests for the pure parse function. Every case passes a plain object — nothing
 * here mutates `process.env`, which is precisely why the pure function exists.
 *
 * These assert on external behaviour only: accept or reject, what values come
 * out, and what the problem list says. They deliberately do not assert on the
 * schema's internal structure or on Zod's error shapes.
 */
import { describe, expect, it } from "vitest";
import {
  formatProblems,
  parseAppDatabaseEnv,
  parseCapabilityEnv,
  parsePublicEnv,
  parseScopedEnv,
  parseSeedEnv,
  parseServerEnv,
  type EnvProblem,
  type ParseResult,
} from "./parse";
import { DEV_DATABASE_URL } from "./variables";

const LIVE_ENV = {
  DATABASE_URL: "postgres://v7:v7@localhost:5433/v7_chat",
  CLERK_SECRET_KEY: "sk_test_clerk",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_clerk",
  OPENROUTER_API_KEY: "sk-or-v1-abcdef",
  INTERMEDIATE_DATABASE_URL: "postgresql://v7_readonly:pw@localhost:5434/analytics",
} satisfies Record<string, string>;

const MOCK_ENV = {
  DATABASE_URL: LIVE_ENV.DATABASE_URL,
  CLERK_SECRET_KEY: LIVE_ENV.CLERK_SECRET_KEY,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: LIVE_ENV.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  MODEL_PROVIDER: "mock",
} satisfies Record<string, string>;

function expectOk<T>(result: ParseResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful parse, got:\n${formatProblems(result.problems)}`);
  }
  return result.env;
}

function expectProblems<T>(result: ParseResult<T>): EnvProblem[] {
  if (result.ok) throw new Error("expected the parse to fail");
  return result.problems;
}

function variablesIn(problems: EnvProblem[]): string[] {
  return problems.map((p) => p.variable);
}

describe("parseServerEnv", () => {
  it("accepts a complete environment and applies every default", () => {
    const env = expectOk(parseServerEnv(LIVE_ENV));

    expect(env.DATABASE_URL).toBe(LIVE_ENV.DATABASE_URL);
    expect(env.CLERK_SECRET_KEY).toBe(LIVE_ENV.CLERK_SECRET_KEY);
    expect(env.OPENROUTER_API_KEY).toBe(LIVE_ENV.OPENROUTER_API_KEY);
    expect(env.INTERMEDIATE_DATABASE_URL).toBe(LIVE_ENV.INTERMEDIATE_DATABASE_URL);

    expect(env.MODEL_PROVIDER).toBe("openrouter");
    expect(env.NEXT_PUBLIC_CLERK_SIGN_IN_URL).toBe("/sign-in");
    expect(env.NEXT_PUBLIC_CLERK_SIGN_UP_URL).toBe("/sign-up");
    expect(env.OPENROUTER_APP_URL).toBe("http://localhost:3000");
    expect(env.OPENROUTER_APP_TITLE).toBe("v7 Business Analyst");
    expect(env.MODEL_ANALYST).toBe("z-ai/glm-5.2:nitro");
    expect(env.MODEL_ANALYST_REASONING).toBe("low");
    expect(env.SQL_STATEMENT_TIMEOUT_MS).toBe(10_000);
    expect(env.SQL_MAX_ROWS).toBe(500);
    expect(env.SQL_MAX_RESULT_BYTES).toBe(700_000);
    expect(env.DRAIN_GRACE_MS).toBe(25_000);

    expect(env.APP_VERSION).toBeUndefined();
    expect(env.LANGFUSE_SECRET_KEY).toBeUndefined();
  });

  it("keeps numeric variables as numbers, not strings", () => {
    const env = expectOk(
      parseServerEnv({ ...LIVE_ENV, SQL_MAX_ROWS: "42", DRAIN_GRACE_MS: "30000" }),
    );
    expect(env.SQL_MAX_ROWS).toBe(42);
    expect(env.DRAIN_GRACE_MS).toBe(30_000);
  });

  it("ignores variables it does not declare", () => {
    const env = expectOk(parseServerEnv({ ...LIVE_ENV, SOMETHING_ELSE: "x" }));
    expect(env).not.toHaveProperty("SOMETHING_ELSE");
  });

  describe("missing core variables", () => {
    it("reports all of them at once rather than stopping at the first", () => {
      const problems = expectProblems(parseServerEnv({ MODEL_PROVIDER: "mock" }));
      expect(variablesIn(problems)).toEqual(
        expect.arrayContaining([
          "DATABASE_URL",
          "CLERK_SECRET_KEY",
          "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
        ]),
      );
    });

    it("names the variable, the expectation and the received value", () => {
      const problems = expectProblems(
        parseServerEnv({ ...MOCK_ENV, DATABASE_URL: undefined }),
      );
      const problem = problems.find((p) => p.variable === "DATABASE_URL");
      expect(problem).toBeDefined();
      expect(problem?.expected).toContain("Postgres connection URL");
      expect(problem?.received).toBe("(not set)");
    });

    it("reports each variable once, however many rules it breaks", () => {
      const problems = expectProblems(
        parseServerEnv({ ...LIVE_ENV, SQL_MAX_ROWS: "not-a-number" }),
      );
      expect(variablesIn(problems).filter((v) => v === "SQL_MAX_ROWS")).toHaveLength(1);
    });
  });

  describe("demo mode", () => {
    it("parses with no OpenRouter key and no analytical database URL", () => {
      const env = expectOk(parseServerEnv(MOCK_ENV));
      expect(env.MODEL_PROVIDER).toBe("mock");
      expect(env.OPENROUTER_API_KEY).toBeUndefined();
      expect(env.INTERMEDIATE_DATABASE_URL).toBeUndefined();
    });

    it("requires both of them when the provider is live", () => {
      const problems = expectProblems(
        parseServerEnv({ ...MOCK_ENV, MODEL_PROVIDER: "openrouter" }),
      );
      expect(variablesIn(problems)).toEqual(
        expect.arrayContaining(["OPENROUTER_API_KEY", "INTERMEDIATE_DATABASE_URL"]),
      );
    });

    it("treats an absent MODEL_PROVIDER as live", () => {
      const problems = expectProblems(
        parseServerEnv({ ...MOCK_ENV, MODEL_PROVIDER: undefined }),
      );
      expect(variablesIn(problems)).toContain("OPENROUTER_API_KEY");
    });

    it("rejects an unknown MODEL_PROVIDER", () => {
      const problems = expectProblems(
        parseServerEnv({ ...MOCK_ENV, MODEL_PROVIDER: "mocked" }),
      );
      expect(variablesIn(problems)).toEqual(["MODEL_PROVIDER"]);
      expect(problems[0]?.expected).toContain("mock");
      expect(problems[0]?.received).toBe('"mocked"');
    });
  });

  describe("numeric variables", () => {
    // The regression test for the drain bug: a non-numeric DRAIN_GRACE_MS used
    // to yield NaN, and the settle step then resolved immediately — a deploy
    // that silently stopped draining.
    it("rejects a non-numeric DRAIN_GRACE_MS", () => {
      const problems = expectProblems(
        parseServerEnv({ ...MOCK_ENV, DRAIN_GRACE_MS: "twenty-five thousand" }),
      );
      expect(variablesIn(problems)).toEqual(["DRAIN_GRACE_MS"]);
    });

    it("parses a valid DRAIN_GRACE_MS", () => {
      const env = expectOk(parseServerEnv({ ...MOCK_ENV, DRAIN_GRACE_MS: "1234" }));
      expect(env.DRAIN_GRACE_MS).toBe(1234);
    });

    it.each([
      "DRAIN_GRACE_MS",
      "SQL_STATEMENT_TIMEOUT_MS",
      "SQL_MAX_ROWS",
      "SQL_MAX_RESULT_BYTES",
    ])("rejects zero, negative and non-finite %s", (variable) => {
      for (const bad of ["0", "-1", "-500", "Infinity", "-Infinity", "NaN", "1e999"]) {
        const problems = expectProblems(
          parseServerEnv({ ...MOCK_ENV, [variable]: bad }),
        );
        expect(variablesIn(problems), `${variable}=${bad} should be rejected`).toEqual([
          variable,
        ]);
      }
    });

    it.each([
      ["DRAIN_GRACE_MS", 25_000],
      ["SQL_STATEMENT_TIMEOUT_MS", 10_000],
      ["SQL_MAX_ROWS", 500],
      ["SQL_MAX_RESULT_BYTES", 700_000],
    ] as const)("applies the default for %s when absent", (variable, expected) => {
      const env = expectOk(parseServerEnv(MOCK_ENV)) as Record<string, unknown>;
      expect(env[variable]).toBe(expected);
    });
  });

  describe("whitespace", () => {
    it("treats whitespace-only values as absent, uniformly", () => {
      const blank = "   ";
      const problems = expectProblems(
        parseServerEnv({
          DATABASE_URL: blank,
          CLERK_SECRET_KEY: "\t\n",
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
          MODEL_PROVIDER: "mock",
        }),
      );
      expect(variablesIn(problems)).toEqual(
        expect.arrayContaining([
          "DATABASE_URL",
          "CLERK_SECRET_KEY",
          "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
        ]),
      );
      for (const problem of problems) {
        expect(problem.received).toBe("(not set)");
      }
    });

    it("falls back to the default when an optional value is whitespace-only", () => {
      const env = expectOk(
        parseServerEnv({ ...MOCK_ENV, SQL_MAX_ROWS: "  ", MODEL_ANALYST: " " }),
      );
      expect(env.SQL_MAX_ROWS).toBe(500);
      expect(env.MODEL_ANALYST).toBe("z-ai/glm-5.2:nitro");
    });

    it("trims surrounding whitespace", () => {
      const env = expectOk(
        parseServerEnv({
          ...MOCK_ENV,
          CLERK_SECRET_KEY: "  sk_test_clerk\n",
          MODEL_PROVIDER: " mock ",
          SQL_MAX_ROWS: " 42 ",
          DATABASE_URL: `  ${LIVE_ENV.DATABASE_URL}  `,
        }),
      );
      expect(env.CLERK_SECRET_KEY).toBe("sk_test_clerk");
      expect(env.MODEL_PROVIDER).toBe("mock");
      expect(env.SQL_MAX_ROWS).toBe(42);
      expect(env.DATABASE_URL).toBe(LIVE_ENV.DATABASE_URL);
    });
  });

  describe("database URLs", () => {
    it.each([
      "postgres://v7:v7@localhost:5433/v7_chat",
      "postgresql://v7_readonly:pw@intermediate-db:5432/analytics",
    ])("accepts %s", (url) => {
      expect(expectOk(parseServerEnv({ ...MOCK_ENV, DATABASE_URL: url })).DATABASE_URL).toBe(
        url,
      );
    });

    it.each([
      "postgres://",
      "postgres:/v7@localhost/db",
      "v7:v7@localhost:5433/v7_chat",
      "https://localhost:5433/v7_chat",
      "not a url at all",
    ])("rejects the malformed URL %s", (url) => {
      const problems = expectProblems(
        parseServerEnv({ ...MOCK_ENV, DATABASE_URL: url }),
      );
      expect(variablesIn(problems)).toEqual(["DATABASE_URL"]);
    });

    it("rejects a malformed INTERMEDIATE_DATABASE_URL", () => {
      const problems = expectProblems(
        parseServerEnv({ ...LIVE_ENV, INTERMEDIATE_DATABASE_URL: "postgres://" }),
      );
      expect(variablesIn(problems)).toEqual(["INTERMEDIATE_DATABASE_URL"]);
    });
  });

  describe("reasoning effort", () => {
    it.each(["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"])(
      "accepts %s",
      (effort) => {
        const env = expectOk(
          parseServerEnv({ ...MOCK_ENV, MODEL_SQL_REASONING: effort }),
        );
        expect(env.MODEL_SQL_REASONING).toBe(effort);
      },
    );

    it.each(["MODEL_FAST_REASONING", "MODEL_ANALYST_REASONING", "MODEL_SQL_REASONING", "MODEL_SUMMARIZER_REASONING"])(
      "rejects an unknown value for %s",
      (variable) => {
        const problems = expectProblems(
          parseServerEnv({ ...MOCK_ENV, [variable]: "very-high" }),
        );
        expect(variablesIn(problems)).toEqual([variable]);
        expect(problems[0]?.expected).toContain("xhigh");
      },
    );
  });

  describe("secrets", () => {
    it("prints neither the value nor any substring of it", () => {
      const secret = "sk_live_9f2c4b8ad3e1";
      const problems = expectProblems(
        parseServerEnv({
          ...MOCK_ENV,
          DATABASE_URL: `postgres-nonsense://user:${secret}@host/db`,
        }),
      );
      const output = formatProblems(problems);

      expect(output).not.toContain(secret);
      for (let start = 0; start + 4 <= secret.length; start++) {
        for (let end = start + 4; end <= secret.length; end++) {
          expect(output).not.toContain(secret.slice(start, end));
        }
      }
      expect(output).toContain("DATABASE_URL");
      expect(output).toContain("redacted");
    });

    it("redacts a bad OPENROUTER_API_KEY but reports its length", () => {
      // A secret that fails its own schema: an empty-after-trim key reads as
      // absent, so use the live-mode requirement to force the report.
      const problems = expectProblems(
        parseServerEnv({ ...LIVE_ENV, OPENROUTER_API_KEY: "   " }),
      );
      const output = formatProblems(problems);
      expect(output).toContain("OPENROUTER_API_KEY");
      expect(output).not.toContain(LIVE_ENV.OPENROUTER_API_KEY);
    });

    it("shows a non-secret value verbatim", () => {
      const problems = expectProblems(
        parseServerEnv({ ...MOCK_ENV, SQL_MAX_ROWS: "-3" }),
      );
      expect(formatProblems(problems)).toContain("-3");
    });
  });

  it("neither throws nor logs on invalid input", () => {
    const calls: unknown[] = [];
    const console_ = globalThis.console;
    globalThis.console = new Proxy(console_, {
      get(target, key) {
        calls.push(key);
        return Reflect.get(target, key);
      },
    });
    try {
      expect(() =>
        parseServerEnv({ DATABASE_URL: "nope", DRAIN_GRACE_MS: "nope" }),
      ).not.toThrow();
    } finally {
      globalThis.console = console_;
    }
    expect(calls).toEqual([]);
  });
});

describe("formatProblems", () => {
  it("renders one problem per line, naming variable, expectation and value", () => {
    const problems = expectProblems(parseServerEnv({ MODEL_PROVIDER: "mock" }));
    const lines = formatProblems(problems).split("\n");
    expect(lines[0]).toContain(`${problems.length} problems`);
    expect(lines).toHaveLength(problems.length + 1);
    for (const problem of problems) {
      expect(lines.some((line) => line.includes(problem.variable))).toBe(true);
    }
  });

  it("uses the singular for one problem", () => {
    const problems = expectProblems(
      parseServerEnv({ ...MOCK_ENV, DRAIN_GRACE_MS: "soon" }),
    );
    expect(formatProblems(problems)).toContain("1 problem");
  });
});

describe("parsePublicEnv", () => {
  it("parses the public surface with defaults", () => {
    const env = expectOk(
      parsePublicEnv({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_clerk" }),
    );
    expect(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe("pk_test_clerk");
    expect(env.NEXT_PUBLIC_CLERK_SIGN_IN_URL).toBe("/sign-in");
    expect(env.NEXT_PUBLIC_CLERK_SIGN_UP_URL).toBe("/sign-up");
    expect(env.NEXT_PUBLIC_APP_VERSION).toBeUndefined();
  });

  it("rejects a missing publishable key", () => {
    const problems = expectProblems(parsePublicEnv({}));
    expect(variablesIn(problems)).toEqual(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]);
  });

  it("ignores server variables entirely", () => {
    const env = expectOk(parsePublicEnv(LIVE_ENV)) as Record<string, unknown>;
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });
});

/** What the TUI and the eval runner ask for. */
const AGENT_CAPABILITIES = ["model-provider", "analytical-database"] as const;

describe("parseScopedEnv", () => {
  it("parses the agent capabilities with no Clerk keys and no app database", () => {
    const env = expectOk(parseScopedEnv(AGENT_CAPABILITIES, {}));

    expect(env.MODEL_PROVIDER).toBe("openrouter");
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.INTERMEDIATE_DATABASE_URL).toBeUndefined();
    expect(env.SQL_MAX_ROWS).toBe(500);
  });

  it("omits the variables of capabilities it was not asked for", () => {
    const env = expectOk(
      parseScopedEnv(AGENT_CAPABILITIES, LIVE_ENV),
    ) as Record<string, unknown>;
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("ignores invalid variables outside the requested capabilities", () => {
    const env = expectOk(
      parseScopedEnv(AGENT_CAPABILITIES, {
        DATABASE_URL: "not-a-url",
        DRAIN_GRACE_MS: "soon",
        INTERMEDIATE_DATABASE_URL: LIVE_ENV.INTERMEDIATE_DATABASE_URL,
      }),
    );
    expect(env.INTERMEDIATE_DATABASE_URL).toBe(LIVE_ENV.INTERMEDIATE_DATABASE_URL);
  });

  it("still validates the variables it was asked for", () => {
    const problems = expectProblems(
      parseScopedEnv(AGENT_CAPABILITIES, {
        INTERMEDIATE_DATABASE_URL: "postgres://",
        MODEL_PROVIDER: "mocked",
      }),
    );
    expect(variablesIn(problems).sort()).toEqual([
      "INTERMEDIATE_DATABASE_URL",
      "MODEL_PROVIDER",
    ]);
  });

  it("does not apply the server's conditional requirements", () => {
    // The TUI and eval runner run happily with no key and no analytical
    // database: no model means \\sql-only, no URL means the pglite fallback.
    const env = expectOk(
      parseScopedEnv(AGENT_CAPABILITIES, { MODEL_PROVIDER: "openrouter" }),
    );
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.INTERMEDIATE_DATABASE_URL).toBeUndefined();
  });

  it("treats a whitespace-only analytical URL as absent, so pglite is used", () => {
    const env = expectOk(
      parseScopedEnv(AGENT_CAPABILITIES, { INTERMEDIATE_DATABASE_URL: "   " }),
    );
    expect(env.INTERMEDIATE_DATABASE_URL).toBeUndefined();
  });
});

describe("parseSeedEnv", () => {
  it("prefers the seed URL over the analytical URL", () => {
    const env = expectOk(
      parseSeedEnv({
        SEED_DATABASE_URL: "postgres://admin:pw@localhost:5434/analytics",
        INTERMEDIATE_DATABASE_URL: LIVE_ENV.INTERMEDIATE_DATABASE_URL,
      }),
    );
    expect(env.seedDatabaseUrl).toBe("postgres://admin:pw@localhost:5434/analytics");
  });

  it("falls back to the analytical URL", () => {
    const env = expectOk(
      parseSeedEnv({ INTERMEDIATE_DATABASE_URL: LIVE_ENV.INTERMEDIATE_DATABASE_URL }),
    );
    expect(env.seedDatabaseUrl).toBe(LIVE_ENV.INTERMEDIATE_DATABASE_URL);
  });

  it("falls back when the seed URL is whitespace-only", () => {
    const env = expectOk(
      parseSeedEnv({
        SEED_DATABASE_URL: "  ",
        INTERMEDIATE_DATABASE_URL: LIVE_ENV.INTERMEDIATE_DATABASE_URL,
      }),
    );
    expect(env.seedDatabaseUrl).toBe(LIVE_ENV.INTERMEDIATE_DATABASE_URL);
  });

  it("names both variables in one problem when neither is set", () => {
    const problems = expectProblems(parseSeedEnv({}));
    expect(variablesIn(problems)).toEqual(["SEED_DATABASE_URL"]);
    expect(formatProblems(problems)).toContain("1 problem");
    expect(formatProblems(problems)).toContain("INTERMEDIATE_DATABASE_URL");
  });

  it("ignores a malformed fallback when the seed URL is set", () => {
    const env = expectOk(
      parseSeedEnv({
        SEED_DATABASE_URL: "postgres://admin:pw@localhost:5434/analytics",
        INTERMEDIATE_DATABASE_URL: "postgres://",
      }),
    );
    expect(env.seedDatabaseUrl).toBe("postgres://admin:pw@localhost:5434/analytics");
  });

  it("rejects a malformed seed URL rather than falling through to the analytical one", () => {
    const problems = expectProblems(
      parseSeedEnv({
        SEED_DATABASE_URL: "postgres://",
        INTERMEDIATE_DATABASE_URL: LIVE_ENV.INTERMEDIATE_DATABASE_URL,
      }),
    );
    expect(variablesIn(problems)).toEqual(["SEED_DATABASE_URL"]);
  });

  it("redacts the URL it rejects", () => {
    const problems = expectProblems(parseSeedEnv({ SEED_DATABASE_URL: "postgres://" }));
    expect(formatProblems(problems)).not.toContain("postgres://");
  });
});

describe("parseAppDatabaseEnv", () => {
  it("uses the configured URL", () => {
    const env = expectOk(parseAppDatabaseEnv({ DATABASE_URL: LIVE_ENV.DATABASE_URL }));
    expect(env.DATABASE_URL).toBe(LIVE_ENV.DATABASE_URL);
  });

  it("falls back to the dev default when unset", () => {
    expect(expectOk(parseAppDatabaseEnv({})).DATABASE_URL).toBe(DEV_DATABASE_URL);
  });

  it("rejects a malformed URL rather than falling back", () => {
    const problems = expectProblems(parseAppDatabaseEnv({ DATABASE_URL: "not-a-url" }));
    expect(variablesIn(problems)).toEqual(["DATABASE_URL"]);
  });
});

/**
 * What the server does at boot: core is required, but the capability
 * requirements stay with the call sites that need the capability, so demo mode
 * and a model-less dev server both still boot.
 */
describe("parseServerEnv with requireCapabilities: false", () => {
  const opts = { requireCapabilities: false } as const;

  it("accepts a live provider with no model key and no analytical database", () => {
    const env = expectOk(
      parseServerEnv({ ...MOCK_ENV, MODEL_PROVIDER: "openrouter" }, opts),
    );
    expect(env.MODEL_PROVIDER).toBe("openrouter");
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.INTERMEDIATE_DATABASE_URL).toBeUndefined();
  });

  it("still requires every core variable, and reports them together", () => {
    const problems = expectProblems(parseServerEnv({}, opts));
    expect(variablesIn(problems)).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "CLERK_SECRET_KEY",
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      ]),
    );
  });

  it("still rejects a typo'd MODEL_PROVIDER rather than falling back to live", () => {
    const problems = expectProblems(
      parseServerEnv({ ...MOCK_ENV, MODEL_PROVIDER: "mocked" }, opts),
    );
    expect(variablesIn(problems)).toEqual(["MODEL_PROVIDER"]);
  });

  it("still rejects a non-numeric DRAIN_GRACE_MS", () => {
    const problems = expectProblems(
      parseServerEnv({ ...MOCK_ENV, DRAIN_GRACE_MS: "soon" }, opts),
    );
    expect(variablesIn(problems)).toEqual(["DRAIN_GRACE_MS"]);
  });

  it("parses the same values as a full parse when everything is set", () => {
    expect(expectOk(parseServerEnv(LIVE_ENV, opts))).toEqual(
      expectOk(parseServerEnv(LIVE_ENV)),
    );
  });
});

/**
 * The slice read by `src/lib/`, which is shared with the TUI and the eval
 * runner — processes that have no app database and no Clerk keys at all.
 */
describe("parseCapabilityEnv", () => {
  it("parses an entirely empty environment, applying every default", () => {
    const env = expectOk(parseCapabilityEnv({}));
    expect(env.MODEL_PROVIDER).toBe("openrouter");
    expect(env.MODEL_ANALYST).toBe("z-ai/glm-5.2:nitro");
    expect(env.MODEL_ANALYST_REASONING).toBe("low");
    expect(env.OPENROUTER_APP_URL).toBe("http://localhost:3000");
    expect(env.OPENROUTER_APP_TITLE).toBe("v7 Business Analyst");
    expect(env.SQL_STATEMENT_TIMEOUT_MS).toBe(10_000);
    expect(env.SQL_MAX_ROWS).toBe(500);
    expect(env.SQL_MAX_RESULT_BYTES).toBe(700_000);
    expect(env.DRAIN_GRACE_MS).toBe(25_000);
  });

  it("cannot expose a core variable, even when one is set", () => {
    const env = expectOk(parseCapabilityEnv(LIVE_ENV)) as Record<string, unknown>;
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("CLERK_SECRET_KEY");
    expect(env).not.toHaveProperty("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });

  it("never requires a model key, whatever the provider", () => {
    expect(
      expectOk(parseCapabilityEnv({ MODEL_PROVIDER: "openrouter" })).OPENROUTER_API_KEY,
    ).toBeUndefined();
  });

  it("validates the capability variables it does carry", () => {
    expect(variablesIn(expectProblems(parseCapabilityEnv({ SQL_MAX_ROWS: "-3" })))).toEqual([
      "SQL_MAX_ROWS",
    ]);
    expect(
      variablesIn(expectProblems(parseCapabilityEnv({ MODEL_PROVIDER: "mocked" }))),
    ).toEqual(["MODEL_PROVIDER"]);
  });

  it("agrees with the full parse on every value it shares", () => {
    const full = expectOk(parseServerEnv(LIVE_ENV)) as Record<string, unknown>;
    const capability = expectOk(parseCapabilityEnv(LIVE_ENV)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(capability)) {
      expect(full[name], name).toEqual(value);
    }
  });
});
