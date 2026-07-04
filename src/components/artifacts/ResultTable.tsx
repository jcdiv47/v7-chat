"use client";

import { useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Column = { name: string; type?: string };
type Row = Record<string, unknown>;

/** Result table with lightweight click-to-sort and horizontal scroll. */
export function ResultTable({
  columns,
  rows,
  rowCount,
  truncated,
}: {
  columns: Column[];
  rows: Row[];
  rowCount?: number;
  truncated?: boolean;
}) {
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);

  const sorted = sort
    ? [...rows].sort((a, b) => compare(a[sort.col], b[sort.col]) * sort.dir)
    : rows;

  const toggleSort = (col: string) =>
    setSort((s) =>
      s?.col === col ? { col, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { col, dir: 1 },
    );

  if (columns.length === 0)
    return <p className="text-sm text-muted-foreground">No columns.</p>;

  return (
    <div>
      <div className="mb-2 text-xs text-muted-foreground">
        {rowCount ?? rows.length} row{(rowCount ?? rows.length) === 1 ? "" : "s"}
        {truncated ? " · truncated to preview" : ""}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {columns.map((c) => (
                <th
                  key={c.name}
                  onClick={() => toggleSort(c.name)}
                  className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-medium hover:bg-accent/60"
                >
                  <span className="inline-flex items-center gap-1">
                    {c.name}
                    <ArrowDownUp
                      className={cn(
                        "size-3 text-muted-foreground",
                        sort?.col === c.name ? "opacity-100" : "opacity-30",
                      )}
                    />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                {columns.map((c) => (
                  <td key={c.name} className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">
                    {formatCell(row[c.name])}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">
                  No rows returned.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function compare(a: unknown, b: unknown): number {
  const na = typeof a === "number" ? a : Number(a);
  const nb = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
