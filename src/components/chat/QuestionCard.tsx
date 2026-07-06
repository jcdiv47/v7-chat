"use client";

/**
 * Interactive card for a trailing `askUser` clarification question. Three
 * states (see docs/specs/10): pending (interactive — latest message,
 * unanswered, no live run), answered (read from the patched part output),
 * and skipped (unanswered but no longer answerable) — dimmed and disabled.
 */
import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AskUserAnswer, AskUserInput } from "@/lib/agent/types";
import type { RenderToolPart } from "@/lib/agent/stream-parts";

export function QuestionCard({
  part,
  interactive,
  onSubmit,
}: {
  part: RenderToolPart;
  /** True only when this is the thread's latest message, the question is
   * unanswered, and no run is live. */
  interactive: boolean;
  onSubmit?: (selected: string[], otherText?: string) => Promise<void>;
}) {
  const input = (part.input ?? {}) as Partial<AskUserInput>;
  const answer =
    part.status === "done" ? (part.output as AskUserAnswer | undefined) : undefined;
  const skipped = !answer && !interactive;
  const multi = input.kind === "multi";
  const options = input.options ?? [];

  const [selected, setSelected] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (label: string) =>
    setSelected((prev) =>
      multi
        ? prev.includes(label)
          ? prev.filter((l) => l !== label)
          : [...prev, label]
        : [label],
    );

  const enabled = interactive && !submitting;
  const canSubmit = enabled && (selected.length > 0 || other.trim().length > 0);

  const submit = async () => {
    if (!canSubmit || !onSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // On success the refetched message renders the answered state; keep
      // `submitting` so the pending controls never re-enable in between.
      await onSubmit(selected, other.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit the answer.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "mt-2 rounded-xl border border-border bg-card p-4",
        skipped && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2.5">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">{input.question}</p>

          <div className="mt-3 space-y-1.5">
            {options.map((opt) => {
              const checked = answer
                ? answer.selected.includes(opt.label)
                : selected.includes(opt.label);
              return (
                <label
                  key={opt.label}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
                    checked ? "border-primary/50 bg-primary/5" : "border-border",
                    enabled ? "cursor-pointer hover:bg-accent" : "cursor-default",
                  )}
                >
                  <input
                    type={multi ? "checkbox" : "radio"}
                    name={part.toolCallId}
                    checked={checked}
                    disabled={!enabled}
                    onChange={() => toggle(opt.label)}
                    className="mt-1 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">{opt.label}</span>
                    {opt.description && (
                      <span className="block text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          {answer ? (
            answer.otherText && (
              <p className="mt-2.5 text-sm text-muted-foreground">
                Other: <span className="text-foreground">{answer.otherText}</span>
              </p>
            )
          ) : (
            <div className="mt-2.5 flex items-center gap-2">
              <input
                type="text"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter") void submit();
                }}
                placeholder={multi ? "Other (optional, combinable)…" : "Other…"}
                disabled={!enabled}
                className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-50"
              />
              <button
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Answer"}
              </button>
            </div>
          )}

          {skipped && (
            <p className="mt-2 text-xs text-muted-foreground">Not answered</p>
          )}
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
