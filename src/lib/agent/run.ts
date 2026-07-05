/**
 * Shared agent runner used by both entrypoints. Builds the AI SDK v7
 * `ToolLoopAgent`, streams it, and calls back per UI message chunk. The web
 * runtime (Convex HTTP action) and the TUI differ only in the tools/deps and the
 * callbacks they pass. See docs/specs/02-agent-runtime.md.
 */
import {
  InvalidToolInputError,
  parsePartialJson,
  stepCountIs,
  ToolLoopAgent,
  toUIMessageStream,
  type LanguageModel,
  type ModelMessage,
  type ToolCallRepairFunction,
  type ToolSet,
  type UIMessageChunk,
} from "ai";
import type { AnalysisRuntimeContext, RunEvent } from "./types";

export type RunAgentUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type RunAgentOptions = {
  model: LanguageModel;
  temperature?: number;
  maxOutputTokens?: number;
  instructions: string;
  messages: ModelMessage[];
  tools: ToolSet;
  /** Max tool-loop steps (spec: 8–12 for interactive chat). */
  maxSteps: number;
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

  const agent = new ToolLoopAgent({
    model: opts.model,
    instructions: opts.instructions,
    tools: opts.tools,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    stopWhen: stepCountIs(opts.maxSteps),
    experimental_repairToolCall: repairTruncatedToolCall,
    runtimeContext: opts.runtimeContext as Record<string, unknown>,
    prepareStep: async ({ stepNumber }) => {
      await opts.onEvent?.({
        type: "step.started",
        createdAt: Date.now(),
        metadata: { stepNumber },
      });
      if (opts.beforeStep) {
        const shouldContinue = await opts.beforeStep(stepNumber);
        if (!shouldContinue) {
          aborted = true;
          controller.abort();
        }
      }
      return undefined;
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
      switch (chunk.type) {
        case "tool-input-available":
          await opts.onEvent?.({
            type: "tool.started",
            createdAt: Date.now(),
            metadata: { toolName: chunk.toolName, toolCallId: chunk.toolCallId },
          });
          break;
        case "tool-output-available":
          await opts.onEvent?.({
            type: "tool.finished",
            createdAt: Date.now(),
            metadata: { toolCallId: chunk.toolCallId },
          });
          break;
        case "tool-output-error":
          await opts.onEvent?.({
            type: "tool.finished",
            createdAt: Date.now(),
            metadata: { toolCallId: chunk.toolCallId, error: chunk.errorText },
          });
          break;
        case "tool-input-error":
          await opts.onEvent?.({
            type: "tool.finished",
            createdAt: Date.now(),
            metadata: { toolCallId: chunk.toolCallId, error: chunk.errorText },
          });
          break;
        default:
          break;
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
  const rawUsage = (await settle(result.usage)) as RunAgentUsage | undefined;
  const steps = (await settle(result.steps))?.length ?? 0;

  return {
    finishReason: String(finishReason),
    usage: rawUsage
      ? {
          inputTokens: rawUsage.inputTokens,
          outputTokens: rawUsage.outputTokens,
          totalTokens: rawUsage.totalTokens,
        }
      : undefined,
    steps,
    aborted,
    errorText,
  };
}
