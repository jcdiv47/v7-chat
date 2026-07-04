"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ModelAlias = "fast" | "analyst" | "sql" | "summarizer";

const MODEL_LABELS: Record<ModelAlias, string> = {
  fast: "Fast",
  analyst: "Analyst",
  sql: "SQL",
  summarizer: "Summarizer",
};

function grow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
}

export function Composer({
  onSend,
  onStop,
  streaming,
  stopping,
  modelAlias,
  onModelAliasChange,
  threadId,
}: {
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
  streaming: boolean;
  stopping: boolean;
  modelAlias: ModelAlias;
  onModelAliasChange: (alias: ModelAlias) => void;
  threadId?: string;
}) {
  const [value, setValue] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Height must track programmatic value changes too (clear on send, restore on failure).
  useEffect(() => {
    if (ref.current) grow(ref.current);
  }, [value]);

  useEffect(() => {
    if (!streaming) ref.current?.focus();
  }, [streaming, threadId]);

  const send = async () => {
    const text = value.trim();
    if (!text) return;
    setValue("");
    setSendError(null);
    try {
      await onSend(text);
    } catch {
      setValue((v) => (v ? `${text}\n\n${v}` : text));
      setSendError("Couldn't send the message — it was restored to the input.");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Enter that confirms an IME composition (Chinese/Japanese/Korean input)
      // must not send the message.
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      <div className="rounded-2xl border border-border bg-card shadow-sm focus-within:border-ring/60">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            grow(e.target);
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Write a message…"
          className="block w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="flex items-center justify-between px-2.5 pb-2.5">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              title="Attach (coming soon)"
              aria-label="Attach (coming soon)"
              disabled
            >
              <Plus />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  {MODEL_LABELS[modelAlias]}
                  <ChevronDown className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(Object.keys(MODEL_LABELS) as ModelAlias[]).map((alias) => (
                  <DropdownMenuItem
                    key={alias}
                    onClick={() => onModelAliasChange(alias)}
                    className={cn(modelAlias === alias && "font-medium")}
                  >
                    {MODEL_LABELS[alias]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {streaming ? (
            <Button
              size="icon"
              variant="secondary"
              onClick={onStop}
              disabled={stopping}
              title="Stop"
              aria-label="Stop run"
              className="rounded-full"
            >
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={() => void send()}
              disabled={!value.trim()}
              title="Send"
              aria-label="Send message"
              className="rounded-full"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
      <p
        className={cn(
          "mt-2 text-center text-[11px]",
          sendError ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {sendError ??
          (stopping
            ? "Stopping after the current step…"
            : streaming
              ? "Press Enter to queue a message for after this run."
              : "Queries run read-only against cities, malls, and stores.")}
      </p>
    </div>
  );
}
