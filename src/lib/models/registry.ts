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
import { wrapLanguageModel, type LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { capabilityEnv } from "../../env/capabilities";
import type { AgentProviderOptions } from "../agent/run";
import type { ModelAlias, ReasoningEffort } from "../agent/types";
import { langfuseCostMiddleware } from "./langfuse-cost";

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
  /** Reasoning effort passed as the AI SDK top-level `reasoning` option
   * (→ `reasoning_effort` on OpenRouter). Note the openai-compatible provider
   * only forwards minimal/low/medium/high/xhigh; "none" and "provider-default"
   * send nothing, i.e. the provider's default applies. */
  reasoning?: ReasoningEffort;
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Default alias → model mapping. Every ID is overridable with a `MODEL_*` env
 * var so aliases can be re-benchmarked without code changes; the defaults and
 * the set of accepted reasoning efforts are declared in src/env/variables.ts,
 * which is why neither appears here.
 */
function buildRegistry(): Record<ModelAlias, ModelDef> {
  const env = capabilityEnv();
  return {
    fast: {
      alias: "fast",
      displayName: "Fast",
      modelId: env.MODEL_FAST,
      temperature: 0.7,
      maxOutputTokens: 2048,
      reasoning: env.MODEL_FAST_REASONING,
    },
    analyst: {
      alias: "analyst",
      displayName: "Analyst",
      modelId: env.MODEL_ANALYST,
      temperature: 0.7,
      maxOutputTokens: 4096,
      reasoning: env.MODEL_ANALYST_REASONING,
    },
    sql: {
      alias: "sql",
      displayName: "SQL",
      modelId: env.MODEL_SQL,
      temperature: 0.5,
      maxOutputTokens: 2048,
      reasoning: env.MODEL_SQL_REASONING,
    },
    summarizer: {
      alias: "summarizer",
      displayName: "Summarizer",
      modelId: env.MODEL_SUMMARIZER,
      temperature: 0.7,
      maxOutputTokens: 1024,
      reasoning: env.MODEL_SUMMARIZER_REASONING,
    },
  };
}

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

function getProvider() {
  if (_provider) return _provider;
  const env = capabilityEnv();
  // Lazy on purpose: the key is gated on the model-provider capability, so this
  // is the first point that genuinely needs it, and this message says more
  // about the fix than generic validation could.
  if (!env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Set it in the server environment " +
        "(.env.local / production variables), or set MODEL_PROVIDER=mock to use the offline demo runner.",
    );
  }
  _provider = createOpenAICompatible({
    name: "openrouter",
    baseURL: OPENROUTER_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY,
    headers: {
      // Attribution headers recommended by OpenRouter.
      "HTTP-Referer": env.OPENROUTER_APP_URL,
      "X-Title": env.OPENROUTER_APP_TITLE,
    },
  });
  return _provider;
}

/** Whether a real model provider is configured. When false, callers fall back
 * to the offline demo runner so the UI/streaming stack is still exercisable. */
export function hasRealModel(): boolean {
  const env = capabilityEnv();
  return env.MODEL_PROVIDER !== "mock" && !!env.OPENROUTER_API_KEY;
}

export function resolveModelDef(alias: ModelAlias): ModelDef {
  return buildRegistry()[alias];
}

/** Resolve an alias to a concrete AI SDK `LanguageModel`. The Langfuse cost
 * middleware is inert unless a tracing span is active. */
export function getModel(alias: ModelAlias): LanguageModel {
  const def = resolveModelDef(alias);
  return wrapLanguageModel({
    model: getProvider()(def.modelId),
    middleware: langfuseCostMiddleware,
  });
}

/** Per-call OpenRouter provider options. Usage accounting must be requested
 * explicitly (`usage.include`) or the response usage never carries `cost`;
 * the openai-compatible provider spreads `providerOptions.openrouter` into
 * the request body. See docs/specs/06-evals-observability.md → Cost Policy. */
export function openrouterProviderOptions(): AgentProviderOptions {
  return { openrouter: { usage: { include: true } } };
}

/** The raw OpenRouter model ID an alias currently resolves to (for logging). */
export function getModelId(alias: ModelAlias): string {
  return resolveModelDef(alias).modelId;
}

export function allModelDefs(): ModelDef[] {
  const registry = buildRegistry();
  return modelAliases.map((alias) => registry[alias]);
}
