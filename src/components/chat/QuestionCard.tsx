"use client";

/**
 * Interactive card for a trailing `askUser` clarification call: 1–3 questions
 * rendered as stacked sections with one submit. Three states (see
 * docs/specs/10): pending (interactive — latest message, unanswered, no live
 * run), answered (read from the patched part output), and skipped (unanswered
 * but no longer answerable) — dimmed and disabled.
 */
import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  normalizeAskUserAnswers,
  normalizeAskUserQuestions,
  type QuestionAnswer,
} from "@/lib/agent/types";
import type { RenderToolPart } from "@/lib/agent/stream-parts";

export function QuestionCard({
  part,
  interactive,
  onSubmit,
}: {
  part: RenderToolPart;
  /** True only when this is the thread's latest message, the questions are
   * unanswered, and no run is live. */
  interactive: boolean;
  onSubmit?: (answers: QuestionAnswer[]) => Promise<void>;
}) {
  const questions = normalizeAskUserQuestions(part.input);
  const answered =
    part.status === "done" ? normalizeAskUserAnswers(part.output) : undefined;
  const skipped = !answered && !interactive;
  const many = questions.length > 1;

  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (qi: number, label: string, multi: boolean) =>
    setSelected((prev) => {
      const current = prev[qi] ?? [];
      const next = multi
        ? current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
        : [label];
      return { ...prev, [qi]: next };
    });

  const otherFor = (qi: number) => (other[qi] ?? "").trim();
  const hasAnswer = (qi: number) =>
    (selected[qi]?.length ?? 0) > 0 || otherFor(qi).length > 0;
  const answeredCount = questions.filter((_, qi) => hasAnswer(qi)).length;

  const enabled = interactive && !submitting;
  // Every question needs a selection or Other text before submit.
  const canSubmit =
    enabled && questions.length > 0 && answeredCount === questions.length;

  const submit = async () => {
    if (!canSubmit || !onSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // On success the refetched message renders the answered state; keep
      // `submitting` so the pending controls never re-enable in between.
      await onSubmit(
        questions.map((_, qi) => ({
          selected: selected[qi] ?? [],
          otherText: otherFor(qi) || undefined,
        })),
      );
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
          {questions.map((q, qi) => {
            const multi = q.kind === "multi";
            const answer = answered?.[qi];
            return (
              <div key={qi} className={cn(qi > 0 && "mt-4 border-t border-border pt-4")}>
                <p className="text-[15px] font-medium">
                  {many && (
                    <span className="mr-1.5 text-muted-foreground">{qi + 1}.</span>
                  )}
                  {q.question}
                </p>

                <div className="mt-3 space-y-1.5">
                  {q.options.map((opt) => {
                    const checked = answer
                      ? answer.selected.includes(opt.label)
                      : (selected[qi] ?? []).includes(opt.label);
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
                          name={`${part.toolCallId}-${qi}`}
                          checked={checked}
                          disabled={!enabled}
                          onChange={() => toggle(qi, opt.label, multi)}
                          className="mt-1 accent-primary"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm text-foreground">
                            {opt.label}
                          </span>
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
                  <input
                    type="text"
                    value={other[qi] ?? ""}
                    onChange={(e) =>
                      setOther((prev) => ({ ...prev, [qi]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === "Enter") void submit();
                    }}
                    placeholder={multi ? "Other (optional, combinable)…" : "Other…"}
                    disabled={!enabled}
                    className="mt-2.5 w-full rounded-lg border border-border bg-transparent px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-50"
                  />
                )}
              </div>
            );
          })}

          {!answered && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {submitting
                  ? "Sending…"
                  : many
                    ? `Answer (${answeredCount}/${questions.length})`
                    : "Answer"}
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
