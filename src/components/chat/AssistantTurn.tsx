"use client";

import { TriangleAlert } from "lucide-react";
import type {
  RenderPart,
  RenderReasoningPart,
  RenderTextPart,
  RenderToolPart,
} from "@/lib/agent/stream-parts";
import { Markdown } from "./Markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolGroup } from "./ToolRow";

type Block =
  | { type: "reasoning"; part: RenderReasoningPart }
  | { type: "tools"; parts: RenderToolPart[] }
  | { type: "text"; part: RenderTextPart };

/** Group consecutive tool parts; keep reasoning and intermediate text separate,
 * preserving the original interleaving (docs/specs/05 → Interleaving). */
function groupParts(parts: RenderPart[]): Block[] {
  const blocks: Block[] = [];
  for (const part of parts) {
    if (part.kind === "tool") {
      const last = blocks[blocks.length - 1];
      if (last && last.type === "tools") last.parts.push(part);
      else blocks.push({ type: "tools", parts: [part] });
    } else if (part.kind === "reasoning") {
      blocks.push({ type: "reasoning", part });
    } else {
      blocks.push({ type: "text", part });
    }
  }
  return blocks;
}

export function AssistantTurn({
  parts,
  streaming,
  durationMs,
  error,
}: {
  parts: RenderPart[];
  streaming: boolean;
  durationMs?: number;
  error?: string;
}) {
  const blocks = groupParts(parts);
  const hasText = blocks.some((b) => b.type === "text" && b.part.text.trim());

  return (
    <div className="space-y-1">
      {blocks.map((block, i) => {
        if (block.type === "reasoning") {
          const active = streaming && !block.part.done;
          return (
            <ThinkingBlock
              key={`r${i}`}
              text={block.part.text}
              active={active}
              durationMs={active ? undefined : durationMs}
            />
          );
        }
        if (block.type === "tools") {
          return <ToolGroup key={`t${i}`} parts={block.parts} />;
        }
        return (
          <div key={`x${i}`} className="pt-1">
            <Markdown>{block.part.text}</Markdown>
          </div>
        );
      })}

      {streaming && blocks.length === 0 && (
        <ThinkingBlock text="" active durationMs={undefined} />
      )}
      {streaming && !hasText && blocks.length > 0 && (
        <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
          Working…
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
