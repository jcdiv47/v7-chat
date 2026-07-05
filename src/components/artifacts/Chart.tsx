"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { ChartSpec } from "@/lib/agent/types";
import type { Axis, ViewSpec } from "@/lib/agent/ui-spec";

type Row = Record<string, unknown>;

/** Fixed categorical assignment — series i always wears chart-(i+1), never
 * cycled (the spec caps line series at 5). */
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const axisTick = { fontSize: 12, fill: "var(--muted-foreground)" };
// Recessive grid: hairline, solid, one step off the surface.
const grid = <CartesianGrid stroke="var(--border)" vertical={false} />;

/**
 * Renders a validated {@link ViewSpec} (all variants except `table` — the
 * caller falls back to ResultTable for that and for anything unplottable)
 * against result rows. Mark specs: thin marks, rounded data-ends at the value
 * end only, 2px lines, dots with a surface ring, recessive solid grid.
 */
export function ViewChart({
  view,
  rows,
  title,
}: {
  view: Exclude<ViewSpec, { type: "table" }>;
  rows: Row[];
  title: string;
}) {
  if (view.type === "stat") {
    const value = rows.length ? rows[0][view.value.column] : null;
    return (
      <div className="rounded-lg border border-border px-4 py-3">
        <div className="text-xs text-muted-foreground">
          {view.value.label ?? title}
        </div>
        <div className="mt-1 text-3xl font-semibold">
          {value == null ? "—" : formatValue(value, view.value.format)}
        </div>
        {view.caption && (
          <div className="mt-1 text-xs text-muted-foreground">{view.caption}</div>
        )}
      </div>
    );
  }

  const bar = view.type === "bar" ? prepareBarData(view, rows) : null;

  return (
    <div className="w-full">
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {/* Called as functions so the chart element is the container's
              direct child (ResponsiveContainer sizes it via cloneElement). */}
          {bar
            ? BarView({ view: view as Extract<ViewSpec, { type: "bar" }>, data: bar.data })
            : view.type === "line"
              ? LineView({ view, rows })
              : ScatterView({ view: view as Extract<ViewSpec, { type: "scatter" }>, rows })}
        </ResponsiveContainer>
      </div>
      {bar?.capped && (
        <p className="mt-1 text-xs text-muted-foreground">
          Showing {bar.data.length} of {rows.length} categories — see the result
          table for the rest.
        </p>
      )}
    </div>
  );
}

/** More categories than this is not a readable bar chart; when the spec sets
 * no `limit`, cap the render instead of drawing an axis smear. */
const BAR_CATEGORY_CAP = 50;

function prepareBarData(view: Extract<ViewSpec, { type: "bar" }>, rows: Row[]) {
  let data = rows.map((r) => ({
    label: String(r[view.x.column] ?? ""),
    value: toNumber(r[view.y.column]),
  }));
  if (view.sort === "asc" || view.sort === "desc") {
    const dir = view.sort === "asc" ? 1 : -1;
    data = [...data].sort(
      (a, b) => ((a.value ?? -Infinity) - (b.value ?? -Infinity)) * dir,
    );
  }
  if (view.limit) data = data.slice(0, view.limit);
  const capped = data.length > BAR_CATEGORY_CAP;
  if (capped) data = data.slice(0, BAR_CATEGORY_CAP);
  return { data, capped };
}

function BarView({
  view,
  data,
}: {
  view: Extract<ViewSpec, { type: "bar" }>;
  data: ReturnType<typeof prepareBarData>["data"];
}) {
  const xName = view.x.label ?? view.x.column;
  const yName = view.y.label ?? view.y.column;
  const tickFmt = (v: number) => formatValue(v, view.y.format);
  // Clean ticks: 0/1/2/3 for counts, never 0.75-steps on an integer measure.
  const allowDecimals = !data.every((d) => d.value == null || Number.isInteger(d.value));
  const tooltip = (
    <Tooltip
      content={<SeriesTooltip labelName={xName} format={view.y.format} />}
      cursor={{ fill: "var(--accent)" }}
    />
  );

  if (view.horizontal) {
    return (
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={tickFmt} allowDecimals={allowDecimals} />
        <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={110} />
        {tooltip}
        <Bar dataKey="value" name={yName} fill="var(--chart-1)" radius={[0, 4, 4, 0]} barSize={16} />
      </BarChart>
    );
  }
  return (
    <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
      {grid}
      <XAxis
        dataKey="label"
        tick={axisTick}
        tickLine={false}
        axisLine={false}
        // Past ~20 categories, let recharts thin the ticks instead of smearing.
        interval={data.length > 20 ? undefined : 0}
        angle={data.length > 6 ? -30 : 0}
        textAnchor={data.length > 6 ? "end" : "middle"}
        height={data.length > 6 ? 60 : 30}
      />
      <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={tickFmt} allowDecimals={allowDecimals} />
      {tooltip}
      <Bar dataKey="value" name={yName} fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
    </BarChart>
  );
}

function LineView({
  view,
  rows,
}: {
  view: Extract<ViewSpec, { type: "line" }>;
  rows: Row[];
}) {
  const data = rows.map((r) => {
    const point: Record<string, unknown> = { label: String(r[view.x.column] ?? "") };
    for (const s of view.y) point[s.column] = toNumber(r[s.column]);
    return point;
  });
  const format = view.y[0]?.format;
  const allowDecimals = !data.every((p) =>
    view.y.every((s) => {
      const v = p[s.column] as number | null;
      return v == null || Number.isInteger(v);
    }),
  );
  return (
    <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
      {grid}
      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
      <YAxis
        tick={axisTick}
        tickLine={false}
        axisLine={false}
        width={44}
        tickFormatter={(v: number) => formatValue(v, format)}
        allowDecimals={allowDecimals}
      />
      <Tooltip
        content={<SeriesTooltip labelName={view.x.label ?? view.x.column} format={format} />}
        cursor={{ stroke: "var(--border)" }}
      />
      {/* Legend only for ≥2 series — one series is named by the title. */}
      {view.y.length > 1 && (
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
      )}
      {view.y.map((s, i) => (
        <Line
          key={s.column}
          type="monotone"
          dataKey={s.column}
          name={s.label ?? s.column}
          stroke={SERIES_COLORS[i]}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          // Surface ring so dots stay legible where lines cross.
          dot={{ r: 4, fill: SERIES_COLORS[i], stroke: "var(--background)", strokeWidth: 2 }}
        />
      ))}
    </LineChart>
  );
}

function ScatterView({
  view,
  rows,
}: {
  view: Extract<ViewSpec, { type: "scatter" }>;
  rows: Row[];
}) {
  const sizeBy = view.sizeBy;
  const data = rows
    .map((r) => ({
      x: toNumber(r[view.x.column]),
      y: toNumber(r[view.y.column]),
      size: sizeBy ? (toNumber(r[sizeBy]) ?? 0) : 0,
    }))
    .filter((p) => p.x != null && p.y != null);
  const xName = view.x.label ?? view.x.column;
  const yName = view.y.label ?? view.y.column;
  return (
    <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
      {grid}
      <XAxis
        type="number"
        dataKey="x"
        name={xName}
        tick={axisTick}
        tickLine={false}
        axisLine={false}
        tickFormatter={(v: number) => formatValue(v, view.x.format)}
      />
      <YAxis
        type="number"
        dataKey="y"
        name={yName}
        tick={axisTick}
        tickLine={false}
        axisLine={false}
        width={44}
        tickFormatter={(v: number) => formatValue(v, view.y.format)}
      />
      {sizeBy && <ZAxis dataKey="size" range={[40, 400]} name={sizeBy} />}
      <Tooltip
        content={<ScatterTooltip xName={xName} yName={yName} sizeName={sizeBy} view={view} />}
        cursor={{ stroke: "var(--border)" }}
      />
      <Scatter
        data={data}
        fill="var(--chart-1)"
        // Surface ring on overlapping dots.
        stroke="var(--background)"
        strokeWidth={2}
      />
    </ScatterChart>
  );
}

/** True when every measure column the view plots has at least one numeric
 * value in the rows — the caller's "can this actually plot" check. */
export function viewIsPlottable(view: ViewSpec, rows: Row[]): boolean {
  const measures: Axis[] =
    view.type === "bar" || view.type === "scatter"
      ? [view.y]
      : view.type === "line"
        ? view.y
        : view.type === "stat"
          ? [view.value]
          : [];
  if (view.type === "scatter") measures.push(view.x); // numeric-vs-numeric
  return measures.every((m) =>
    rows.some((r) => toNumber(r[m.column]) != null),
  );
}

/** Format a value per the axis `format` hint. The dataset is Chinese malls,
 * so `currency` renders CNY. */
export function formatValue(value: unknown, format?: Axis["format"]): string {
  const n = toNumber(value);
  if (n == null) return String(value ?? "—");
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: "CNY",
        maximumFractionDigits: 0,
      }).format(n);
    case "percent":
      return new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(n);
    case "compact":
      return new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
    default:
      return new Intl.NumberFormat().format(n);
  }
}

function SeriesTooltip({
  active,
  payload,
  label,
  labelName,
  format,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | null; color?: string }>;
  label?: string;
  labelName: string;
  format?: Axis["format"];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="text-muted-foreground">
        {labelName}: <span className="text-foreground">{label}</span>
      </div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-muted-foreground">
          {payload.length > 1 && (
            <span className="size-2 rounded-full" style={{ background: p.color }} />
          )}
          {p.name}:{" "}
          <span className="font-medium text-foreground">
            {p.value == null ? "—" : formatValue(p.value, format)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScatterTooltip({
  active,
  payload,
  xName,
  yName,
  sizeName,
  view,
}: {
  active?: boolean;
  payload?: Array<{ payload: { x: number | null; y: number | null; size: number } }>;
  xName: string;
  yName: string;
  sizeName?: string;
  view: Extract<ViewSpec, { type: "scatter" }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="text-muted-foreground">
        {xName}: <span className="text-foreground">{formatValue(p.x, view.x.format)}</span>
      </div>
      <div className="text-muted-foreground">
        {yName}: <span className="font-medium text-foreground">{formatValue(p.y, view.y.format)}</span>
      </div>
      {sizeName && (
        <div className="text-muted-foreground">
          {sizeName}: <span className="text-foreground">{formatValue(p.size)}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy path — pre-presentData `chartSpec` artifacts (docs/specs/08 keeps
// this render path for existing rows; no migration).
// ---------------------------------------------------------------------------

/** Renders a LEGACY chart spec against result rows. New views go through
 * {@link ViewChart}. */
export function Chart({ spec, rows }: { spec: ChartSpec; rows: Row[] }) {
  if (spec.type === "none" || spec.type === "table") {
    return (
      <p className="text-sm text-muted-foreground">
        This result is best shown as a table.
      </p>
    );
  }
  if (!spec.x || !spec.y || rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough information to render this chart.
      </p>
    );
  }

  const view: ViewSpec =
    spec.type === "line"
      ? { type: "line", x: { column: spec.x }, y: [{ column: spec.y }] }
      : {
          type: "bar",
          x: { column: spec.x },
          y: { column: spec.y },
          horizontal: spec.type === "horizontalBar",
        };
  return <ViewChart view={view} rows={rows} title={spec.title} />;
}

/** NULL / non-numeric measures become null (a gap in the chart), not a fake 0
 * bar that's indistinguishable from a real zero. */
function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
