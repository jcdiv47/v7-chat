"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";

export function ThinkingBlock({
  text,
  active,
  durationMs,
}: {
  text: string;
  /** True while reasoning is still streaming for this turn. */
  active: boolean;
  durationMs?: number;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? active;

  const header = active
    ? "Thinking…"
    : durationMs
      ? `Worked for ${formatDuration(durationMs)}`
      : "Thought for a moment";

  return (
    <div className="my-1.5">
      <button
        onClick={() => setOverride(!open)}
        className="flex items-center gap-1.5 rounded-md py-0.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {active ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ChevronRight
            className={cn("size-3.5 transition-transform", open && "rotate-90")}
          />
        )}
        {header}
      </button>
      {open && text.trim().length > 0 && (
        <div className="mt-1 border-l-2 border-border pl-3 text-[13.5px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}
