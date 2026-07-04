"use client";

import type { RenderToolPart } from "@/lib/agent/stream-parts";
import { CodeBlock } from "./CodeBlock";

type SqlOutput = {
  ok?: boolean;
  columns?: { name: string; type?: string }[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  truncated?: boolean;
  executionTimeMs?: number;
  error?: string;
};

export function ToolDetail({ part }: { part: RenderToolPart }) {
  const input = (part.input ?? {}) as Record<string, unknown>;

  if (part.name === "runSql") {
    const output = (part.output ?? {}) as SqlOutput;
    return (
      <div className="space-y-2">
        {typeof input.sql === "string" && (
          <CodeBlock code={input.sql} language="sql" className="my-0" />
        )}
        {output.ok === false || part.status === "error" ? (
          <p className="text-[13px] text-destructive">
            {output.error ?? part.errorText ?? "Query failed."}
          </p>
        ) : output.columns ? (
          <>
            <p className="text-[12px] text-muted-foreground">
              {output.rowCount ?? output.rows?.length ?? 0} row(s)
              {output.truncated ? " (truncated)" : ""}
              {output.executionTimeMs != null ? ` · ${output.executionTimeMs}ms` : ""}
            </p>
            <MiniTable columns={output.columns} rows={output.rows ?? []} />
          </>
        ) : null}
      </div>
    );
  }

  if (part.name === "listTables") {
    const tables = ((part.output as { tables?: { name: string }[] })?.tables) ?? [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {tables.map((t) => (
          <span
            key={t.name}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]"
          >
            {t.name}
          </span>
        ))}
      </div>
    );
  }

  if (part.name === "describeTable") {
    const columns =
      ((part.output as { columns?: { name: string; type: string }[] })?.columns) ?? [];
    return (
      <div className="space-y-0.5 font-mono text-[12px] text-muted-foreground">
        {columns.map((c) => (
          <div key={c.name}>
            <span className="text-foreground">{c.name}</span> {c.type}
          </div>
        ))}
      </div>
    );
  }

  return (
    <pre className="overflow-x-auto rounded bg-muted px-2 py-1.5 text-[12px]">
      {JSON.stringify({ input: part.input, output: part.output }, null, 2).slice(0, 1200)}
    </pre>
  );
}

function MiniTable({
  columns,
  rows,
}: {
  columns: { name: string }[];
  rows: Record<string, unknown>[];
}) {
  if (rows.length === 0)
    return <p className="text-[12px] text-muted-foreground">No rows.</p>;
  return (
    <div className="overflow-x-auto rounded border border-border/60">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border/60 bg-muted/50">
            {columns.map((c) => (
              <th key={c.name} className="px-2 py-1 text-left font-medium">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((row, i) => (
            <tr key={i} className="border-b border-border/40 last:border-0">
              {columns.map((c) => (
                <td key={c.name} className="px-2 py-1 font-mono">
                  {formatCell(row[c.name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
