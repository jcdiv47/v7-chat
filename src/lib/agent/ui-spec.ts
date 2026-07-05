/**
 * The generative-UI view spec — the single source of truth shared by the
 * `presentData` tool, the persistence layer, and the frontend renderer. See
 * docs/specs/08-generative-ui.md.
 *
 * Two-stage validation: the SDK tool boundary accepts the permissive flat
 * {@link presentDataInput} (weak models fumble a JSON-Schema `anyOf`, and an
 * unrepairable InvalidToolInputError aborts the run), and the strict
 * {@link viewSpec} discriminated union is enforced inside `execute`, where a
 * failure is a normal tool result the model can correct.
 *
 * Import-safe on the client (zod only).
 */
import { z } from "zod";

const axis = z.object({
  column: z.string(),
  label: z.string().optional().describe("Display label; defaults to the column name."),
  format: z
    .enum(["number", "currency", "percent", "compact"])
    .optional()
    .describe("Rendering hint for values; has no effect on the data."),
});

export type Axis = z.infer<typeof axis>;

export const viewSpec = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("table"),
    columns: z
      .array(z.string())
      .nonempty()
      .optional()
      .describe("Subset/order of result columns; default all."),
  }),
  z.object({
    type: z.literal("bar"),
    x: axis,
    y: axis,
    horizontal: z.boolean().optional().describe("Use for long category labels."),
    sort: z.enum(["asc", "desc", "none"]).optional(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  z.object({
    type: z.literal("line"),
    x: axis,
    y: z.array(axis).min(1).max(5).describe("One axis per series."),
  }),
  z.object({
    type: z.literal("scatter"),
    x: axis,
    y: axis,
    sizeBy: z.string().optional().describe("Column that scales point size."),
  }),
  z.object({
    type: z.literal("stat"),
    value: axis,
    caption: z.string().optional(),
  }),
]);

export type ViewSpec = z.infer<typeof viewSpec>;

/** Payload stored on a `view` artifact. */
export type ViewArtifactPayload = {
  view: ViewSpec;
  resultId: string;
  title: string;
};

/** Permissive flat input for the `presentData` tool (the SDK boundary). */
export const presentDataInput = z.object({
  title: z.string().describe("Short human title for the view."),
  type: z.enum(["table", "bar", "line", "scatter", "stat"]),
  resultId: z
    .string()
    .optional()
    .describe("resultId from a runSql output; defaults to this turn's only result."),
  x: z.string().optional().describe("Dimension column."),
  y: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Measure column(s); array = multi-series (line only)."),
  columns: z
    .array(z.string())
    .optional()
    .describe("Table only: subset/order of result columns; default all."),
  horizontal: z.boolean().optional().describe("Bar only: use for long category labels."),
  sort: z.enum(["asc", "desc", "none"]).optional().describe("Bar only: sort by measure."),
  limit: z.number().optional().describe("Bar only: keep the top N categories (max 50)."),
  sizeBy: z.string().optional().describe("Scatter only: column that scales point size."),
  caption: z.string().optional().describe("Stat only: one-line context under the value."),
  format: z
    .enum(["number", "currency", "percent", "compact"])
    .optional()
    .describe("How to format the measure values."),
});

export type PresentDataInput = z.infer<typeof presentDataInput>;

const firstY = (y: PresentDataInput["y"]): string | undefined =>
  Array.isArray(y) ? y[0] : y;

/**
 * Map the flat tool input onto a strict-spec candidate. Purely structural —
 * the result still goes through `viewSpec.safeParse`, so a shape this cannot
 * express (e.g. scatter with two y columns) surfaces as a parse error the
 * model can correct.
 */
export function normalizeViewInput(input: PresentDataInput): unknown {
  const ax = (column: string | undefined, format?: PresentDataInput["format"]) =>
    column == null ? undefined : { column, ...(format ? { format } : {}) };

  switch (input.type) {
    case "table":
      return { type: "table", ...(input.columns?.length ? { columns: input.columns } : {}) };
    case "bar":
      return {
        type: "bar",
        x: ax(input.x),
        y: ax(firstY(input.y), input.format),
        horizontal: input.horizontal,
        sort: input.sort,
        limit: input.limit,
      };
    case "line":
      return {
        type: "line",
        x: ax(input.x),
        y:
          input.y == null
            ? undefined
            : (Array.isArray(input.y) ? input.y : [input.y]).map((column) =>
                ax(column, input.format),
              ),
      };
    case "scatter":
      return {
        type: "scatter",
        x: ax(input.x),
        // Deliberately not unwrapped: a y array is a spec error for scatter.
        y: Array.isArray(input.y) && input.y.length > 1 ? input.y : ax(firstY(input.y), input.format),
        sizeBy: input.sizeBy,
      };
    case "stat":
      return {
        type: "stat",
        value: ax(firstY(input.y) ?? input.x, input.format),
        caption: input.caption,
      };
  }
}

const VARIANT_HINTS: Record<ViewSpec["type"], string> = {
  table: "table takes an optional columns array",
  bar: "bar requires x (dimension) and a single y (measure)",
  line: "line requires x and 1-5 y columns",
  scatter: "scatter requires x and a single numeric y",
  stat: "stat requires one value column (pass it as y)",
};

/** One readable line from a failed strict parse, for the tool error result. */
export function formatViewSpecError(
  type: ViewSpec["type"],
  error: z.ZodError,
): string {
  const issues = error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .slice(0, 3)
    .join("; ");
  return `${VARIANT_HINTS[type]}; got ${issues}`;
}

/** Columns a spec references, for existence checks against the result. */
export function referencedColumns(view: ViewSpec): string[] {
  switch (view.type) {
    case "table":
      return view.columns ?? [];
    case "bar":
      return [view.x.column, view.y.column];
    case "line":
      return [view.x.column, ...view.y.map((a) => a.column)];
    case "scatter":
      return [view.x.column, view.y.column, ...(view.sizeBy ? [view.sizeBy] : [])];
    case "stat":
      return [view.value.column];
  }
}

/** Successful `presentData` tool output — what the frontend renders from. */
export type PresentDataOutput =
  | { ok: true; viewId: string; resultId: string; view: ViewSpec }
  | { ok: false; error: string };
