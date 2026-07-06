/**
 * Language-model middleware that forwards OpenRouter's response cost to the
 * Langfuse generation observation. The Langfuse AI SDK integration maps token
 * usage but not cost (verified against @langfuse/vercel-ai-sdk 5.9.1), so per
 * docs/specs/06-evals-observability.md → Langfuse Cost Policy the raw
 * `usage.raw.cost` is attached manually as the observation's cost details.
 *
 * The AI SDK invokes the model call inside the integration's generation span
 * context, so the active span at doGenerate/doStream time is exactly that
 * generation observation. Inert when no span is recording (tracing disabled,
 * demo mode, TUI, evals).
 */
import { trace, type Span } from "@opentelemetry/api";
import type { LanguageModelMiddleware } from "ai";

/** Langfuse OTel attribute (`LangfuseOtelSpanAttributes.OBSERVATION_COST_DETAILS`). */
const COST_DETAILS_ATTRIBUTE = "langfuse.observation.cost_details";

type StreamResult = Awaited<
  ReturnType<NonNullable<LanguageModelMiddleware["wrapStream"]>>
>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer PART> ? PART : never;

function costFromRawUsage(raw: unknown): number | undefined {
  const cost = (raw as { cost?: unknown } | undefined)?.cost;
  return typeof cost === "number" ? cost : undefined;
}

function setCost(span: Span, cost: number | undefined): void {
  if (cost == null) return;
  span.setAttribute(COST_DETAILS_ATTRIBUTE, JSON.stringify({ total: cost }));
}

export const langfuseCostMiddleware: LanguageModelMiddleware = {
  async wrapGenerate({ doGenerate }) {
    const span = trace.getActiveSpan();
    const result = await doGenerate();
    if (span?.isRecording()) setCost(span, costFromRawUsage(result.usage.raw));
    return result;
  },

  async wrapStream({ doStream }) {
    // Capture the span now: the generation span is active only while the call
    // is initiated, not when stream chunks arrive later.
    const span = trace.getActiveSpan();
    const result = await doStream();
    if (!span?.isRecording()) return result;
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream<StreamPart, StreamPart>({
          transform(part, controller) {
            if (part.type === "finish") {
              setCost(span, costFromRawUsage(part.usage.raw));
            }
            controller.enqueue(part);
          },
        }),
      ),
    };
  },
};
