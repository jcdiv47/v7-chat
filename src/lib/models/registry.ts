/**
 * Model registry — the single place that maps stable aliases to concrete
 * OpenRouter model IDs. Agent code depends only on aliases, so changing a model
 * is a one-line edit here (or an env override). See docs/specs/02-agent-runtime.md.
 *
 * OpenRouter is the first-class provider. It exposes an OpenAI-compatible API,
 * so we use the stable `@ai-sdk/openai-compatible` provider (which pairs cleanly
 * with `ai@7`) pointed at OpenRouter's gateway. Swapping to the native
 * `@openrouter/ai-sdk-provider` later is a change contained to this file.
 */
import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelAlias } from "../agent/types";

export const modelAliases = [
  "fast",
  "analyst",
  "sql",
  "summarizer",
] as const satisfies readonly ModelAlias[];

export type ModelDef = {
  alias: ModelAlias;
  /** Human-readable name used in logs and the UI model selector. */
  displayName: string;
  /** OpenRouter model ID, e.g. "anthropic/claude-3.5-sonnet". */
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
  /** Optional cost metadata (USD per 1M tokens) for run cost estimation. */
  cost?: { inputPerMTokens?: number; outputPerMTokens?: number };
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/**
 * Default alias → model mapping. Every ID is overridable with a `MODEL_*` env
 * var so aliases can be re-benchmarked without code changes. These defaults are
 * long-lived OpenRouter slugs; confirm/tune them during implementation.
 */
function buildRegistry(): Record<ModelAlias, ModelDef> {
  return {
    fast: {
      alias: "fast",
      displayName: "Fast",
      modelId: env("MODEL_FAST") ?? "openai/gpt-4o-mini",
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
    analyst: {
      alias: "analyst",
      displayName: "Analyst",
      modelId: env("MODEL_ANALYST") ?? "anthropic/claude-3.5-sonnet",
      temperature: 0.3,
      maxOutputTokens: 4096,
    },
    sql: {
      alias: "sql",
      displayName: "SQL",
      modelId: env("MODEL_SQL") ?? "anthropic/claude-3.5-sonnet",
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
    summarizer: {
      alias: "summarizer",
      displayName: "Summarizer",
      modelId: env("MODEL_SUMMARIZER") ?? "openai/gpt-4o-mini",
      temperature: 0.2,
      maxOutputTokens: 1024,
    },
  };
}

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

function getProvider() {
  if (_provider) return _provider;
  const apiKey = env("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Set it in the server environment " +
        "(.env.local / Railway variables), or set MODEL_PROVIDER=mock to use the offline demo runner.",
    );
  }
  _provider = createOpenAICompatible({
    name: "openrouter",
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    headers: {
      // Attribution headers recommended by OpenRouter.
      "HTTP-Referer": env("OPENROUTER_APP_URL") ?? "http://localhost:3000",
      "X-Title": env("OPENROUTER_APP_TITLE") ?? "v7 Business Analyst",
    },
  });
  return _provider;
}

/** Whether a real model provider is configured. When false, callers fall back
 * to the offline demo runner so the UI/streaming stack is still exercisable. */
export function hasRealModel(): boolean {
  return env("MODEL_PROVIDER") !== "mock" && !!env("OPENROUTER_API_KEY");
}

export function resolveModelDef(alias: ModelAlias): ModelDef {
  return buildRegistry()[alias];
}

/** Resolve an alias to a concrete AI SDK `LanguageModel`. */
export function getModel(alias: ModelAlias): LanguageModel {
  const def = resolveModelDef(alias);
  return getProvider()(def.modelId);
}

/** The raw OpenRouter model ID an alias currently resolves to (for logging). */
export function getModelId(alias: ModelAlias): string {
  return resolveModelDef(alias).modelId;
}

export function allModelDefs(): ModelDef[] {
  const registry = buildRegistry();
  return modelAliases.map((alias) => registry[alias]);
}
