"use client";

import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, MessageSquare, Search } from "lucide-react";
import { trpc, type ThreadSummary } from "@/lib/trpc";
import { cn, recencyBucket, recencyLabels } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type Thread = ThreadSummary;

/** Command-palette title search over saved chats. Empty query shows recents.
 * Full keyboard control. */
export function SearchModal({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim();
  const recents = trpc.threads.list.useQuery(undefined, { enabled: open });
  const found = trpc.threads.search.useQuery(
    { query: q },
    { enabled: open && q.length > 0, placeholderData: (prev) => prev },
  );
  const results: Thread[] = q
    ? (found.data ?? [])
    : (recents.data ?? []).slice(0, 12);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const choose = (t: Thread) => {
    onSelect(t.id);
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = results[index];
      if (t) choose(t);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12%] max-w-xl overflow-hidden p-0" onKeyDown={onKeyDown}>
        <DialogTitle className="sr-only">Search chats</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3.5">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matches.
            </p>
          ) : (
            results.map((t, i) => (
              <button
                key={t.id}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(t)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm",
                  i === index ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{t.title}</span>
                <span className="text-[11px] text-muted-foreground">
                  {recencyLabels[recencyBucket(t.updatedAt)]}
                </span>
                {i === index && (
                  <CornerDownLeft className="size-3.5 text-muted-foreground" />
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
