"use client";

import { useRef } from "react";
import { TriangleAlert } from "lucide-react";
import type { RenderPart, RenderTextPart } from "@/lib/agent/stream-parts";
import { Markdown } from "./Markdown";
import { WorkBlock } from "./WorkBlock";

/** The trailing run of text parts is the final answer; everything before it
 * (reasoning, tool calls, intermediate text) is "work" shown in the WorkBlock.
 * While streaming, a text part is treated as final as soon as it starts — if a
 * later tool call arrives it folds back into the work block on the next fold. */
function splitParts(parts: RenderPart[]): {
  work: RenderPart[];
  finalText: string;
  hasFinal: boolean;
} {
  let i = parts.length;
  while (i > 0 && parts[i - 1].kind === "text") i--;
  const work = parts.slice(0, i);
  const finalText = parts
    .slice(i)
    .map((p) => (p as RenderTextPart).text)
    .join("\n\n");
  return { work, finalText, hasFinal: i < parts.length };
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
  const { work, finalText, hasFinal } = splitParts(parts);
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
