"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { CornerDownLeft, MessageSquare, Search } from "lucide-react";
import { api, type Doc, type Id } from "@/lib/convexApi";
import { cn, recencyBucket, recencyLabels } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type Thread = Pick<Doc<"threads">, "_id" | "title" | "pinned" | "updatedAt" | "createdAt">;

/** Command-palette search over sessions. Fuzzy-ish (subsequence) match on title;
 * empty query shows recents. Full keyboard control. */
export function SearchModal({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: Id<"threads">) => void;
}) {
  const threads = (useQuery(api.threads.list) ?? []) as Thread[];
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads.slice(0, 12);
    return threads
      .filter((t) => subsequence(q, t.title.toLowerCase()))
      .slice(0, 20);
  }, [query, threads]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const choose = (t: Thread) => {
    onSelect(t._id);
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
        <DialogTitle className="sr-only">Search chats and projects</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3.5">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats and projects"
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
                key={t._id}
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

/** True if `needle` is a subsequence of `haystack` (loose fuzzy match). */
function subsequence(needle: string, haystack: string): boolean {
  if (haystack.includes(needle)) return true;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}
