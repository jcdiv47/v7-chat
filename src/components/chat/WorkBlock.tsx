"use client";

import { useState } from "react";
import { ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import {
  toolLabel,
  type RenderPart,
  type RenderToolPart,
} from "@/lib/agent/stream-parts";
import { Markdown } from "./Markdown";
import { ToolDetail } from "./ToolRow";

/**
 * The collapsible "work" block for an assistant turn: reasoning, tool calls and
 * any intermediate text, rendered as a timeline along a vertical rail. Each
 * tool call is a dot on the rail. Open with "Working…" while the agent is
 * still working; collapsed with "Worked for Ns" once the final answer starts.
 */
export function WorkBlock({
  parts,
  working,
  durationMs,
}: {
  parts: RenderPart[];
  /** True while the agent is still reasoning / calling tools for this turn. */
  working: boolean;
  durationMs?: number;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? working;

  const header = working
    ? "Working…"
    : durationMs != null
      ? `Worked for ${formatDuration(durationMs)}`
      : "Worked for a moment";

  return (
    <div className="my-1.5">
      <button
        onClick={() => setOverride(!open)}
        className="flex items-center gap-1.5 rounded-md py-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {working ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ChevronRight
            className={cn("size-3.5 transition-transform", open && "rotate-90")}
          />
        )}
        {header}
      </button>
      {open && parts.length > 0 && (
        <div className="mt-1.5 ml-[6px] space-y-3 border-l-2 border-border py-1 pl-4">
          {parts.map((part, i) => {
            if (part.kind === "tool") {
              return <WorkToolRow key={part.toolCallId} part={part} />;
            }
            if (part.kind === "reasoning") {
              return (
                <div
                  key={`r${i}`}
                  className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
                >
                  {part.text}
                </div>
              );
            }
            // Intermediate text the model emitted between tool calls.
            return (
              <div key={`x${i}`} className="text-[13.5px] text-muted-foreground">
                <Markdown>{part.text}</Markdown>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkToolRow({ part }: { part: RenderToolPart }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      {/* Dot on the rail: pl-4 (16px) + border-l-2 center (1px) + half of size-2 (4px). */}
      <span
        className={cn(
          "absolute top-[5px] -left-[21px] size-2 rounded-full",
          part.status === "running" && "animate-pulse bg-foreground/70",
          part.status === "done" && "bg-emerald-500",
          part.status === "error" && "bg-destructive",
        )}
      />
      <button
        onClick={() => setOpen((o) => !o)}
        className="group flex items-center gap-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="truncate">{toolLabel(part)}</span>
        {part.status === "running" && (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        )}
        {part.status === "error" && (
          <TriangleAlert className="size-3 shrink-0 text-destructive" />
        )}
        <ChevronRight
          className={cn(
            "size-3 shrink-0 opacity-0 transition-transform group-hover:opacity-100",
            open && "rotate-90 opacity-100",
          )}
        />
      </button>
      {open && (
        <div className="mt-1.5">
          <ToolDetail part={part} />
        </div>
      )}
    </div>
  );
}
