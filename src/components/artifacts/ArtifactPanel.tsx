"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Bug, X } from "lucide-react";
import { api, type Doc, type Id } from "@/lib/convexApi";
import type { ChartSpec } from "@/lib/agent/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/chat/CodeBlock";
import { Markdown } from "@/components/chat/Markdown";
import { Chart } from "./Chart";
import { ResultTable } from "./ResultTable";

type Artifact = Doc<"artifacts">;

export function ArtifactPanel({
  runId,
  onClose,
}: {
  runId: Id<"runs">;
  onClose: () => void;
}) {
  const artifacts = (useQuery(api.artifacts.listForRun, { runId }) ?? []) as Artifact[];
  const run = useQuery(api.runs.get, { runId });
  const events = useQuery(api.events.listForRun, { runId }) ?? [];
  const answer = useQuery(
    api.messages.get,
    run?.assistantMessageId ? { messageId: run.assistantMessageId } : "skip",
  );
  const [showDev, setShowDev] = useState(false);

  const sql = artifacts.filter((a) => a.type === "sql");
  const tables = artifacts.filter((a) => a.type === "table");
  const charts = artifacts.filter((a) => a.type === "chartSpec");
  const errors = artifacts.filter((a) => a.type === "error");

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="text-sm font-medium">Analysis</div>
        <div className="flex items-center gap-1">
          <button
            title="Toggle run events (debug)"
            onClick={() => setShowDev((d) => !d)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Bug className="size-4" />
          </button>
          <button
            title="Close"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <Tabs defaultValue="answer" className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-3">
          <TabsList>
            <TabsTrigger value="answer">Answer</TabsTrigger>
            <TabsTrigger value="sql">SQL{sql.length ? ` (${sql.length})` : ""}</TabsTrigger>
            <TabsTrigger value="table">Table{tables.length ? ` (${tables.length})` : ""}</TabsTrigger>
            <TabsTrigger value="chart">Chart</TabsTrigger>
            {showDev && <TabsTrigger value="events">Run Events</TabsTrigger>}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <TabsContent value="answer">
            {answer?.text ? (
              <Markdown>{answer.text}</Markdown>
            ) : (
              <Empty label="No answer yet." />
            )}
            {run && (
              <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                <Meta k="Status" v={run.status} />
                <Meta k="Model" v={`${run.modelAlias}${run.modelId ? ` · ${run.modelId}` : ""}`} />
                <Meta k="Skills" v={run.skillsVersion} />
                {run.loadedSkillNames.length > 0 && (
                  <Meta k="Loaded" v={run.loadedSkillNames.join(", ")} />
                )}
                {run.sqlCount != null && <Meta k="Queries" v={String(run.sqlCount)} />}
                {run.error && <Meta k="Error" v={run.error} />}
              </div>
            )}
          </TabsContent>

          <TabsContent value="sql" className="space-y-3">
            {sql.length === 0 && errors.length === 0 ? (
              <Empty label="No SQL was run." />
            ) : (
              <>
                {sql.map((a) => (
                  <CodeBlock key={a._id} code={String(a.payload.sql ?? "")} language="sql" className="my-0" />
                ))}
                {errors.map((a) => (
                  <div key={a._id} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <CodeBlock code={String(a.payload.sql ?? "")} language="sql" className="my-0" />
                    <p className="mt-2 text-[13px] text-destructive">{String(a.payload.error ?? "")}</p>
                  </div>
                ))}
              </>
            )}
          </TabsContent>

          <TabsContent value="table" className="space-y-6">
            {tables.length === 0 ? (
              <Empty label="No result tables." />
            ) : (
              tables.map((a) => (
                <div key={a._id}>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">{a.title}</div>
                  <ResultTable
                    columns={(a.payload.columns as { name: string }[]) ?? []}
                    rows={(a.payload.rows as Record<string, unknown>[]) ?? []}
                    rowCount={a.payload.rowCount as number | undefined}
                    truncated={a.payload.truncated as boolean | undefined}
                  />
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="chart" className="space-y-6">
            {charts.length === 0 ? (
              <Empty label="No chart was produced. Ask for a chart of a grouped result." />
            ) : (
              charts.map((a) => {
                const spec = a.payload as unknown as ChartSpec;
                const rows = rowsForChart(spec, tables);
                return <Chart key={a._id} spec={spec} rows={rows} />;
              })
            )}
          </TabsContent>

          {showDev && (
            <TabsContent value="events" className="space-y-1">
              {events.map((e) => (
                <div key={e._id} className="rounded border border-border/60 px-2 py-1 font-mono text-[11px]">
                  <span className="text-muted-foreground">
                    {new Date(e.createdAt).toLocaleTimeString()}{" "}
                  </span>
                  <span className="text-foreground">{e.type}</span>
                  {e.metadata && Object.keys(e.metadata).length > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      {JSON.stringify(e.metadata).slice(0, 200)}
                    </span>
                  )}
                </div>
              ))}
              {events.length === 0 && <Empty label="No events." />}
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}

function rowsForChart(spec: ChartSpec, tables: Artifact[]): Record<string, unknown>[] {
  // Only rows whose SQL matches the chart's source — no "last table" fallback:
  // a chart silently rendered from unrelated data is worse than the empty state.
  const match = tables.find((t) => t.payload.sql === spec.sourceSql);
  return (match?.payload.rows as Record<string, unknown>[]) ?? [];
}

function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-muted-foreground/70">{k}</span>
      <span className="text-foreground/90">{v}</span>
    </div>
  );
}
