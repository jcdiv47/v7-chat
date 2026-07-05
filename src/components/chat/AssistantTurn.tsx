"use client";

import { useRef } from "react";
import { TriangleAlert } from "lucide-react";
import type {
  RenderPart,
  RenderTextPart,
  RenderToolPart,
} from "@/lib/agent/stream-parts";
import type { PresentDataOutput } from "@/lib/agent/ui-spec";
import { DataView } from "@/components/artifacts/DataView";
import { Markdown } from "./Markdown";
import { WorkBlock } from "./WorkBlock";

const isView = (p: RenderPart): p is RenderToolPart =>
  p.kind === "tool" && p.name === "presentData";

/** The trailing run of text parts is the final answer; everything before it
 * (reasoning, tool calls, intermediate text) is "work" shown in the WorkBlock.
 * While streaming, a text part is treated as final as soon as it starts — if a
 * later tool call arrives it folds back into the work block on the next fold.
 * presentData parts are the exception on both counts: they are lifted out of
 * the work list into `views` (product, not process — rendered between the
 * work block and the answer, in stream order), and the trailing scan skips
 * them so a view call placed after the answer prose does not fold the answer
 * back into the work block. */
function splitParts(parts: RenderPart[]): {
  work: RenderPart[];
  views: RenderToolPart[];
  finalText: string;
  hasFinal: boolean;
} {
  let i = parts.length;
  while (i > 0 && (parts[i - 1].kind === "text" || isView(parts[i - 1]))) i--;
  const work = parts.slice(0, i).filter((p) => !isView(p));
  const views = parts.filter(isView);
  const trailingText = parts.slice(i).filter((p) => p.kind === "text");
  const finalText = trailingText
    .map((p) => (p as RenderTextPart).text)
    .join("\n\n");
  return { work, views, finalText, hasFinal: trailingText.length > 0 };
}

export function AssistantTurn({
  parts,
  streaming,
  durationMs,
  workStartedAt,
  error,
}: {
  parts: RenderPart[];
  streaming: boolean;
  /** Persisted turn duration (completed messages). */
  durationMs?: number;
  /** Run start time; used to compute the live duration when work finishes
   * mid-stream, before the persisted durationMs exists. */
  workStartedAt?: number;
  error?: string;
}) {
  const { work, views, finalText, hasFinal } = splitParts(parts);
  const working = streaming && !hasFinal;

  // Freeze the elapsed time the moment work completes, so the collapsed header
  // shows a stable "Worked for Ns" while the final answer streams in.
  const frozenMs = useRef<number | undefined>(undefined);
  if (working) frozenMs.current = undefined;
  else if (frozenMs.current == null && workStartedAt != null) {
    frozenMs.current = Date.now() - workStartedAt;
  }

  const showWork = work.length > 0 || working;

  return (
    <div className="space-y-1">
      {showWork && (
        <WorkBlock
          parts={work}
          working={working}
          durationMs={durationMs ?? frozenMs.current}
        />
      )}

      {views.map((part) => {
        // Render only validated success outputs; a running or failed
        // presentData call shows nothing (the model retries within the run).
        const output = part.output as PresentDataOutput | undefined;
        if (part.status !== "done" || output?.ok !== true) return null;
        const title = (part.input as { title?: string } | undefined)?.title ?? "View";
        return (
          <div key={part.toolCallId} className="py-2">
            <DataView view={output.view} resultId={output.resultId} title={title} />
          </div>
        );
      })}

      {finalText.trim() && (
        <div className="pt-1">
          <Markdown>{finalText}</Markdown>
        </div>
      )}

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
