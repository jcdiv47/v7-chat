"use client";

import { BarChart3 } from "lucide-react";

const SUGGESTIONS = [
  "How many malls are in each city?",
  "Which malls have the most stores?",
  "Are there malls with no stores?",
  "Compare store counts across cities.",
];

export function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
      <div className="mb-6 flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <BarChart3 className="size-6" />
      </div>
      <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">
        Ask about malls, stores, and cities
      </h1>
      <p className="mb-8 max-w-md text-center text-sm text-muted-foreground">
        An analyst that inspects the schema, writes read-only SQL, and explains
        the results with tables and charts.
      </p>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="rounded-xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:border-ring/50 hover:bg-accent"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
