"use client";

import { z } from "zod";
import { trpc } from "@/lib/trpc";
import type { SqlColumn } from "@/lib/agent/types";
import { referencedColumns, viewSpec, type ViewSpec } from "@/lib/agent/ui-spec";
import { ResultTable } from "./ResultTable";
import { ViewChart, viewIsPlottable } from "./Chart";

/**
 * Renders a `presentData` view: re-validates the spec with the shared Zod
 * schema, fetches the referenced result rows via `artifacts.get`, and degrades
 * to a plain result table on any failure (corrupt spec, missing column,
 * unplottable data) — never a broken or empty chart. No reactivity needed:
 * the table artifact row is committed before the presentData output chunk
 * reaches any client, so the query finds it on first render.
 */
export function DataView({
  view,
  resultId,
  title,
}: {
  /** Unvalidated spec from the tool output part / artifact payload. */
  view: unknown;
  resultId: string;
  title: string;
}) {
  // A corrupt resultId would fail the query's input validation; skip instead.
  const validResultId = z.uuid().safeParse(resultId).success;
  const { data: artifact, isPending } = trpc.artifacts.get.useQuery(
    { artifactId: resultId },
    { enabled: validResultId, staleTime: Infinity },
  );

  if (!validResultId || (!isPending && (!artifact || artifact.type !== "table"))) {
    return (
      <p className="text-sm text-muted-foreground">
        The data behind “{title}” is no longer available.
      </p>
    );
  }
  if (isPending || !artifact) {
    return <div className="h-[300px] w-full animate-pulse rounded-lg bg-muted/50" />;
  }

  const columns = (artifact.payload.columns as SqlColumn[] | undefined) ?? [];
  const rows = (artifact.payload.rows as Record<string, unknown>[] | undefined) ?? [];
  const table = (subset?: string[]) => {
    // The spec's `columns` is subset AND order — map the requested names
    // through a lookup rather than filtering (which keeps result order).
    const byName = new Map(columns.map((c) => [c.name, c]));
    const shown = subset
      ? subset.flatMap((name) => byName.get(name) ?? [])
      : columns;
    return (
      <ResultTable
        columns={shown}
        rows={rows}
        rowCount={artifact.payload.rowCount as number | undefined}
        truncated={artifact.payload.truncated as boolean | undefined}
      />
    );
  };

  const parsed = viewSpec.safeParse(view);
  if (!parsed.success) return table();

  const spec: ViewSpec = parsed.data;
  const names = columns.map((c) => c.name);
  const missingColumn = referencedColumns(spec).some((c) => !names.includes(c));
  if (missingColumn) return table();

  if (spec.type === "table") return table(spec.columns);
  if (rows.length === 0 || !viewIsPlottable(spec, rows)) return table();

  return <ViewChart view={spec} rows={rows} title={title} />;
}
