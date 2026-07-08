"use client";

import { useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Column = { name: string; type?: string };
type Row = Record<string, unknown>;

/** Rows-per-page choices. The result set is already row-capped upstream
 * (SQL_MAX_ROWS), so this only bounds how much lands in the DOM at once. */
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

/** Result table with click-to-sort, horizontal scroll, and client-side
 * pagination over the (already row-capped) result set. */
export function ResultTable({
  columns,
  rows,
  rowCount,
  truncated,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  columns: Column[];
  rows: Row[];
  rowCount?: number;
  truncated?: boolean;
  pageSize?: number;
}) {
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(
    PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  );

  const sorted = sort
    ? [...rows].sort((a, b) => compare(a[sort.col], b[sort.col]) * sort.dir)
    : rows;

  const toggleSort = (col: string) => {
    setPage(0);
    setSort((s) =>
      s?.col === col ? { col, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { col, dir: 1 },
    );
  };

  if (columns.length === 0)
    return <p className="text-sm text-muted-foreground">No columns.</p>;

  // Clamp the page rather than storing it — keeps state valid when `rows` or
  // the page size changes underneath it.
  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const current = Math.min(page, pageCount - 1);
  const start = current * rowsPerPage;
  const pageRows = sorted.slice(start, start + rowsPerPage);
  const showPagination = sorted.length > rowsPerPage;

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
            {pageRows.map((row, i) => (
              <tr key={start + i} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
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
      {showPagination && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="whitespace-nowrap">Rows per page</span>
            <Select
              value={String(rowsPerPage)}
              onValueChange={(v) => {
                setRowsPerPage(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger className="w-18">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectGroup>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <span className="whitespace-nowrap px-1 text-sm tabular-nums text-muted-foreground">
                  {start + 1}–{Math.min(start + rowsPerPage, sorted.length)} of {sorted.length}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setPage(current - 1)}
                  disabled={current === 0}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={() => setPage(current + 1)}
                  disabled={current >= pageCount - 1}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
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
