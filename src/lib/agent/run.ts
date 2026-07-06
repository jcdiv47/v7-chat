/**
 * Shared agent runner used by both entrypoints. Builds the AI SDK v7
 * `ToolLoopAgent`, streams it, and calls back per UI message chunk. The web
 * runtime and the TUI differ only in the tools/deps and the callbacks they
 * pass. See docs/specs/02-agent-runtime.md.
 */
import {
  InvalidToolInputError,
  parsePartialJson,
  stepCountIs,
  ToolLoopAgent,
  toUIMessageStream,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolCallRepairFunction,
  type ToolLoopAgentSettings,
  type ToolSet,
  type UIMessageChunk,
} from "ai";
import type { AnalysisRuntimeContext, ReasoningEffort, RunEvent } from "./types";

/** Provider-specific call options (`ai` does not re-export ProviderOptions). */
export type AgentProviderOptions = NonNullable<
  ToolLoopAgentSettings["providerOptions"]
>;

/** Run-level usage, widened for Langfuse readiness (docs/specs/06 → Run
 * Records): provider token details plus OpenRouter raw usage and cost. */
export type RunAgentUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
  /** Raw provider usage payloads, one per model step. A run makes one
   * OpenRouter request per step, so there is no single merged raw payload. */
  raw?: Record<string, unknown>[];
  /** Sum of per-step OpenRouter `raw.cost` values, when present. */
  costUsd?: number;
};

/** SDK-level timeouts: `chunkMs` catches a provider that stops sending stream
 * chunks; `stepMs`/`totalMs` bound one LLM step and the whole run. Tool
 * executions are bounded by the SQL executor's own statement timeout, so no
 * per-tool timeouts here (the SDK only passes tools an abort signal — it does
 * not race their execution). */
export type RunAgentTimeout = {
  totalMs?: number;
  stepMs?: number;
  chunkMs?: number;
};

export type RunAgentOptions = {
  model: LanguageModel;
  temperature?: number;
  maxOutputTokens?: number;
  /** Reasoning effort forwarded as the AI SDK top-level `reasoning` option. */
  reasoning?: ReasoningEffort;
  instructions: string;
  messages: ModelMessage[];
  tools: ToolSet;
  /** Max tool-loop steps (spec: 8–12 for interactive chat). */
  maxSteps: number;
  /** Provider-specific options forwarded on every model call (e.g. OpenRouter
   * usage accounting — see registry.openrouterProviderOptions). */
  providerOptions?: AgentProviderOptions;
  timeout?: RunAgentTimeout;
  runtimeContext: AnalysisRuntimeContext;
  abortSignal?: AbortSignal;
  /** Called for every UI message chunk (serialize to the stream / print). */
  onChunk: (chunk: UIMessageChunk) => void | Promise<void>;
  /** Coarse lifecycle events for observability. */
  onEvent?: (event: RunEvent) => void | Promise<void>;
  /** Called before each step: stamp heartbeat + check stop. Return false to stop. */
  beforeStep?: (stepNumber: number) => boolean | Promise<boolean>;
};

export type RunAgentResult = {
  finishReason: string;
  usage?: RunAgentUsage;
  steps: number;
  aborted: boolean;
  errorText?: string;
};

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Name-based only (also covers DOMException, which isn't an Error in Node):
 * message sniffing would misclassify provider errors like "connection aborted
 * by remote host" as user cancels. The caller additionally checks whether *we*
 * aborted via `controller.signal.aborted`. */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Some models (e.g. kimi-k2.6) occasionally emit tool-call JSON that is cut off
 * mid-string, which fails `JSON.parse` and would abort the whole run. Salvage
 * it with `parsePartialJson`, which closes unterminated strings/brackets. Only
 * `repaired-parse` helps here: a `successful-parse` means the JSON was fine and
 * the input failed schema validation instead, which re-stringifying can't fix.
 */
const repairTruncatedToolCall: ToolCallRepairFunction<ToolSet> = async ({
  toolCall,
  error,
}) => {
  if (!InvalidToolInputError.isInstance(error)) return null;
  const { value, state } = await parsePartialJson(toolCall.input);
  if (state !== "repaired-parse" || value === null || typeof value !== "object") {
    return null;
  }
  return { ...toolCall, input: JSON.stringify(value) };
};

async function settle<T>(p: PromiseLike<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch {
    return undefined;
  }
}

function addTokens(a?: number, b?: number): number | undefined {
  return a == null && b == null ? undefined : (a ?? 0) + (b ?? 0);
}

/** Sum one step's usage into the running total, preserving token details, the
 * step's raw provider payload, and OpenRouter's per-step `raw.cost`. */
function accumulateUsage(
  acc: RunAgentUsage | undefined,
  step: LanguageModelUsage,
): RunAgentUsage {
  const raw = step.raw as Record<string, unknown> | undefined;
  const stepCost = typeof raw?.cost === "number" ? raw.cost : undefined;
  return {
    inputTokens: addTokens(acc?.inputTokens, step.inputTokens),
    outputTokens: addTokens(acc?.outputTokens, step.outputTokens),
    totalTokens: addTokens(acc?.totalTokens, step.totalTokens),
    inputTokenDetails: {
      noCacheTokens: addTokens(
        acc?.inputTokenDetails?.noCacheTokens,
        step.inputTokenDetails?.noCacheTokens,
      ),
      cacheReadTokens: addTokens(
        acc?.inputTokenDetails?.cacheReadTokens,
        step.inputTokenDetails?.cacheReadTokens,
      ),
      cacheWriteTokens: addTokens(
        acc?.inputTokenDetails?.cacheWriteTokens,
        step.inputTokenDetails?.cacheWriteTokens,
      ),
    },
    outputTokenDetails: {
      textTokens: addTokens(
        acc?.outputTokenDetails?.textTokens,
        step.outputTokenDetails?.textTokens,
      ),
      reasoningTokens: addTokens(
        acc?.outputTokenDetails?.reasoningTokens,
        step.outputTokenDetails?.reasoningTokens,
      ),
    },
    raw: raw ? [...(acc?.raw ?? []), raw] : acc?.raw,
    costUsd: stepCost != null ? (acc?.costUsd ?? 0) + stepCost : acc?.costUsd,
  };
}

function pruneEmptyDetails<T extends Record<string, number | undefined>>(
  details: T | undefined,
): T | undefined {
  if (!details) return undefined;
  return Object.values(details).some((v) => v != null) ? details : undefined;
}

/** Final run usage: SDK-computed aggregates when available (they also cover
 * provider-merged token details), always paired with the per-step raw
 * payloads and summed cost from the accumulation. */
function buildRunUsage(
  aggregate: LanguageModelUsage | undefined,
  acc: RunAgentUsage | undefined,
): RunAgentUsage | undefined {
  const base = aggregate ?? acc;
  if (!base) return undefined;
  return {
    inputTokens: base.inputTokens,
    outputTokens: base.outputTokens,
    totalTokens: base.totalTokens,
    inputTokenDetails: pruneEmptyDetails(base.inputTokenDetails),
    outputTokenDetails: pruneEmptyDetails(base.outputTokenDetails),
    raw: acc?.raw?.length ? acc.raw : undefined,
    costUsd: acc?.costUsd,
  };
}

/** Appended to the system instructions on the final allowed step (tools are
 * disabled for that step) so the run ends with an answer instead of a
 * mid-investigation tool call cut off by the step limit. */
const FINAL_STEP_NOTICE =
  "\n\nThis is your final step: tools are no longer available. Give your best " +
  "final answer now, based on the results you have already gathered. If the " +
  "analysis is incomplete, say what is known so far and what remains open.";

export async function runAnalysisAgent(
  opts: RunAgentOptions,
): Promise<RunAgentResult> {
  const controller = new AbortController();
  if (opts.abortSignal) {
    if (opts.abortSignal.aborted) controller.abort();
    else
      opts.abortSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
  }

  let aborted = false;
  let errorText: string | undefined;
  // Accumulated across onStepEnd callbacks so usage and step counts survive a
  // run that errors mid-way (the aggregate result promises reject in that case).
  let stepsCompleted = 0;
  let accUsage: RunAgentUsage | undefined;

  const agent = new ToolLoopAgent({
    model: opts.model,
    instructions: opts.instructions,
    tools: opts.tools,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    reasoning: opts.reasoning,
    providerOptions: opts.providerOptions,
    timeout: opts.timeout,
    stopWhen: stepCountIs(opts.maxSteps),
    experimental_repairToolCall: repairTruncatedToolCall,
    runtimeContext: opts.runtimeContext as Record<string, unknown>,
    // Inert unless a telemetry integration is registered (web worker only).
    // Only scalar runtime context keys are exposed — no payloads.
    telemetry: {
      functionId: "analysis-agent",
      includeRuntimeContext: {
        requestId: true,
        runId: true,
        threadId: true,
        userId: true,
        modelAlias: true,
        skillsVersion: true,
      },
    },
    prepareStep: async ({ stepNumber }) => {
      // stepNumber is zero-based; the last allowed step forbids tool calls
      // (plus a wrap-up notice), forcing a final answer instead of a truncated
      // tool loop. toolChoice "none" rather than activeTools []: the tool
      // definitions must stay with the request, because a model that has
      // called tools all run may emit one more call anyway — with the
      // definitions gone the SDK escalates that to a fatal NoSuchToolError,
      // failing the whole run; with them present it degrades to one ordinary
      // tool step before stopWhen ends the loop.
      const finalStep = stepNumber >= opts.maxSteps - 1;
      await opts.onEvent?.({
        type: "step.started",
        createdAt: Date.now(),
        metadata: finalStep ? { stepNumber, forcedFinal: true } : { stepNumber },
      });
      if (opts.beforeStep) {
        const shouldContinue = await opts.beforeStep(stepNumber);
        if (!shouldContinue) {
          aborted = true;
          controller.abort();
        }
      }
      if (finalStep) {
        return {
          toolChoice: "none" as const,
          instructions: opts.instructions + FINAL_STEP_NOTICE,
        };
      }
      return undefined;
    },
    onToolExecutionStart: async ({ toolCall }) => {
      await opts.onEvent?.({
        type: "tool.started",
        createdAt: Date.now(),
        metadata: { toolName: toolCall.toolName, toolCallId: toolCall.toolCallId },
      });
    },
    onToolExecutionEnd: async ({ toolCall, toolOutput, toolExecutionMs }) => {
      await opts.onEvent?.({
        type: "tool.finished",
        createdAt: Date.now(),
        metadata: {
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          toolExecutionMs,
          error:
            toolOutput.type === "tool-error" ? errText(toolOutput.error) : undefined,
        },
      });
    },
    onStepEnd: async (step) => {
      stepsCompleted += 1;
      accUsage = accumulateUsage(accUsage, step.usage);
      await opts.onEvent?.({
        type: "step.finished",
        createdAt: Date.now(),
        metadata: {
          stepNumber: step.stepNumber,
          finishReason: step.finishReason,
          usage: step.usage,
          stepTimeMs: step.performance.stepTimeMs,
          responseTimeMs: step.performance.responseTimeMs,
          outputTokensPerSecond: step.performance.outputTokensPerSecond,
          warnings: step.warnings?.length ? step.warnings : undefined,
        },
      });
    },
  });

  const result = await agent.stream({
    messages: opts.messages,
    abortSignal: controller.signal,
  });

  const uiStream = toUIMessageStream({
    stream: result.stream,
    sendReasoning: true,
    sendStart: true,
    sendFinish: true,
    onError: (err) => {
      errorText = errText(err);
      return errorText;
    },
  });

  // `toUIMessageStream` returns a web ReadableStream; read it via a reader
  // (TS does not type ReadableStream as async-iterable).
  const reader = uiStream.getReader();
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      // Tool start/finish events come from the agent lifecycle callbacks —
      // except invalid tool inputs, which never reach execution, so the only
      // trace of them is this stream chunk.
      if (chunk.type === "tool-input-error") {
        await opts.onEvent?.({
          type: "tool.finished",
          createdAt: Date.now(),
          metadata: { toolCallId: chunk.toolCallId, error: chunk.errorText },
        });
      }
      await opts.onChunk(chunk);
    }
  } catch (err) {
    if (controller.signal.aborted || isAbortError(err)) {
      aborted = true;
    } else {
      errorText = errText(err);
    }
  } finally {
    reader.releaseLock();
  }

  const finishReason = (await settle(result.finishReason)) ?? (aborted ? "abort" : "unknown");
  // Fall back to the per-step accumulation when the aggregate promises reject
  // (aborted/failed runs), so partial usage — including raw payloads and cost
  // — still lands in the run record.
  const aggregateUsage = await settle(result.usage);
  const steps = (await settle(result.steps))?.length ?? stepsCompleted;

  return {
    finishReason: String(finishReason),
    usage: buildRunUsage(aggregateUsage, accUsage),
    steps,
    aborted,
    errorText,
  };
}
