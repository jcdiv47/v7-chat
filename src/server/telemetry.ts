/**
 * Langfuse tracing bootstrap (docs/specs/06-evals-observability.md → V2
 * Langfuse Path). One primary integration path: AI SDK 7 telemetry exported
 * to Langfuse through OpenTelemetry — model-call and tool-call observations
 * come from `LangfuseVercelAiSdkIntegration`; no parallel manual trace tree.
 * Langfuse is an async observability sink: initialization is skipped entirely
 * when the keys are absent or the app runs in demo mode, and nothing in the
 * run path depends on it.
 */
import { registerTelemetry } from "ai";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getLangfuseRelease } from "../lib/app-version";
import { hasRealModel } from "../lib/models/registry";

const globalStore = globalThis as unknown as {
  /** null = initialized and disabled; undefined = not initialized yet. */
  __v7Telemetry?: { processor: LangfuseSpanProcessor } | null;
};

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function langfuseEnabled(): boolean {
  return (
    hasRealModel() &&
    env("LANGFUSE_PUBLIC_KEY") != null &&
    env("LANGFUSE_SECRET_KEY") != null
  );
}

/**
 * Initialize OpenTelemetry + the Langfuse AI SDK integration once at process
 * boot, before any ToolLoopAgent run starts. Returns whether tracing is on.
 */
export function initTelemetry(): boolean {
  if (globalStore.__v7Telemetry !== undefined) {
    return globalStore.__v7Telemetry !== null;
  }
  if (!langfuseEnabled()) {
    globalStore.__v7Telemetry = null;
    return false;
  }

  const processor = new LangfuseSpanProcessor({
    publicKey: env("LANGFUSE_PUBLIC_KEY"),
    secretKey: env("LANGFUSE_SECRET_KEY"),
    baseUrl: env("LANGFUSE_BASE_URL"),
    // Passed explicitly: the SDK's own auto-read variable is named
    // LANGFUSE_TRACING_ENVIRONMENT, which we don't rely on.
    environment: env("LANGFUSE_ENVIRONMENT"),
    release: getLangfuseRelease(),
  });
  new NodeSDK({ spanProcessors: [processor] }).start();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());

  globalStore.__v7Telemetry = { processor };
  return true;
}

/**
 * Flush batched spans. Must run on graceful shutdown: spans are exported
 * asynchronously, so a deploy without a final flush drops the tail of every
 * run in flight.
 */
export async function flushTelemetry(): Promise<void> {
  const state = globalStore.__v7Telemetry;
  if (!state) return;
  try {
    await state.processor.forceFlush();
  } catch (err) {
    console.error("[telemetry] Langfuse flush failed:", err);
  }
}
