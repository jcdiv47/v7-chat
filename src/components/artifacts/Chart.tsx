"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSpec } from "@/lib/agent/types";

type Row = Record<string, unknown>;

/** Renders a chart spec against result rows. Single measure → single hue
 * (no legend). Falls back to a note when the spec can't be plotted. Applies the
 * dataviz mark specs: thin marks, rounded data-ends, recessive grid, hover. */
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

  const x = spec.x;
  const y = spec.y;
  const data = rows.map((r) => ({
    label: String(r[x] ?? ""),
    value: toNumber(r[y]),
  }));

  const axisTick = { fontSize: 12, fill: "var(--muted-foreground)" };
  const grid = <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />;

  return (
    <div className="w-full">
      <h4 className="mb-2 text-sm font-medium">{spec.title}</h4>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === "line" ? (
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              {grid}
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={36} />
              <Tooltip content={<ChartTooltip xLabel={x} yLabel={y} />} cursor={{ stroke: "var(--border)" }} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={{ r: 3, fill: "var(--chart-1)" }}
              />
            </LineChart>
          ) : spec.type === "horizontalBar" ? (
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
            >
              {grid}
              <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="label"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={110}
              />
              <Tooltip content={<ChartTooltip xLabel={x} yLabel={y} />} cursor={{ fill: "var(--accent)" }} />
              <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              {grid}
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval={0} angle={data.length > 6 ? -30 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 60 : 30} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={36} />
              <Tooltip content={<ChartTooltip xLabel={x} yLabel={y} />} cursor={{ fill: "var(--accent)" }} />
              <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  xLabel,
  yLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; value: number | null } }>;
  xLabel: string;
  yLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const { label, value } = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="text-muted-foreground">
        {xLabel}: <span className="text-foreground">{label}</span>
      </div>
      <div className="text-muted-foreground">
        {yLabel}: <span className="font-medium text-foreground">{value ?? "—"}</span>
      </div>
    </div>
  );
}

/** NULL / non-numeric measures become null (a gap in the chart), not a fake 0
 * bar that's indistinguishable from a real zero. */
function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
