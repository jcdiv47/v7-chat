# 08 Generative UI

## Goal

The agent decides, per answer, whether a visualization aids interpretation — and
which one: a result table, bar chart, line chart, scatter plot, or a single-stat
callout. The mechanism is typed end to end (one Zod schema drives the tool, the
persistence layer, and the renderer) while the choice itself stays with the
model: whether to present a view at all, which variant, and how to map result
columns onto it.

This builds on pieces that already exist: `runSql` results are auto-saved as
`table` artifacts (`03-data-access.md`), assistant turns render from ordered
parts (`05-frontend-ux.md`), and the tool loop streams UI message chunks
(`02-agent-runtime.md`). What is new: a `presentData` tool, a shared view-spec
schema, result references by id, and inline rendering in the conversation.

## Design Summary

- **One tool, `presentData`**, callable zero or more times per turn. Each call
  produces one inline view in the conversation and one `view` artifact.
- **Data by reference.** A view names the query result it visualizes by
  `resultId` (the id of the auto-saved `table` artifact). The agent never
  re-types rows, so views cost few tokens and cannot hallucinate data points.
- **Two-stage validation.** The tool's `inputSchema` is a permissive flat
  object; the strict discriminated union is enforced inside `execute`, and
  failures return as structured tool results the model can correct on the next
  step. A schema failure never kills a run.
- **The renderer trusts only validated output.** The frontend renders from the
  normalized spec in the tool's output part, re-checks it with the same Zod
  schema, and degrades to a plain result table on any failure.
- **Inline placement.** Views render in the conversation between the work block
  and the final answer text, in stream order. The artifact panel remains the
  home for SQL, full tables, and debugging.

## The View Spec

The single source of truth lives in `src/lib/agent/ui-spec.ts`, shared by the
tool `execute`, backend validation, and the frontend renderer. It replaces
`ChartSpec` in `src/lib/agent/types.ts`.

```ts
const axis = z.object({
  column: z.string(),
  label: z.string().optional(),
  format: z.enum(["number", "currency", "percent", "compact"]).optional(),
});

export const viewSpec = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string()).nonempty().optional(), // subset/order; default all
  }),
  z.object({
    type: z.literal("bar"),
    x: axis,
    y: axis,
    horizontal: z.boolean().optional(), // long category labels
    sort: z.enum(["asc", "desc", "none"]).optional(),
    limit: z.number().int().positive().max(50).optional(),
  }),
  z.object({
    type: z.literal("line"),
    x: axis,
    y: z.array(axis).min(1).max(5), // multi-series
  }),
  z.object({
    type: z.literal("scatter"),
    x: axis,
    y: axis,
    sizeBy: z.string().optional(),
  }),
  z.object({
    type: z.literal("stat"), // scalar answers
    value: axis,
    caption: z.string().optional(),
  }),
]);

export type ViewSpec = z.infer<typeof viewSpec>;
```

Rules:

- Adding a view type is one union member plus one renderer case; nothing else
  changes.
- `.describe()` annotations on fields are the model-facing documentation — keep
  them current when the schema evolves.
- Axis `label` defaults to the column name; `format` is a rendering hint only.

## The `presentData` Tool

### Why the input schema is permissive

Models arrive through `@ai-sdk/openai-compatible` via OpenRouter and are
env-swappable. A `z.discriminatedUnion` used directly as `inputSchema` compiles
to a JSON-Schema `anyOf`, which weaker models fumble — and an
`InvalidToolInputError` that `experimental_repairToolCall` cannot fix (it only
repairs truncated JSON) aborts the whole run. So the SDK boundary accepts a
flat superset and the strict union is enforced one layer down, where failure is
a normal tool result the loop can recover from.

### Input schema (SDK boundary)

```ts
inputSchema: z.object({
  title: z.string(),
  type: z.enum(["table", "bar", "line", "scatter", "stat"]),
  resultId: z
    .string()
    .optional()
    .describe("resultId from a runSql output; defaults to this turn's only result"),
  x: z.string().optional().describe("dimension column"),
  y: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("measure column(s); array = multi-series (line only)"),
  horizontal: z.boolean().optional(),
  sort: z.enum(["asc", "desc", "none"]).optional(),
  limit: z.number().optional(),
  sizeBy: z.string().optional(),
  caption: z.string().optional(),
  format: z.enum(["number", "currency", "percent", "compact"]).optional(),
})
```

### `execute` pipeline

1. **Normalize** the flat input into a `viewSpec` candidate: column-name
   strings become axis objects, `y` string-or-array becomes the variant's
   shape, `stat` maps `y`/`x` onto `value`.
2. **Strict parse** with `viewSpec.safeParse`. On failure, return
   `{ ok: false, error: "line requires x and at least one y; got …" }`.
3. **Resolve the result.** If `resultId` is missing and the turn ran exactly
   one query, use it; if missing and ambiguous, return an error naming the
   available ids. Look up the result via `deps.getResultMeta(resultId)`; an
   unknown id is an error.
4. **Check columns.** Every referenced column must exist in the result. On
   failure, return `{ ok: false, error: "column 'city' not in result (has:
   city_name, store_count)" }`.
5. **Save** a `view` artifact via the existing `saveArtifact` dep:
   `payload = { view, resultId, title }`.
6. **Return** `{ ok: true, viewId, resultId, view }` — where `view` is the
   normalized, validated spec. This output is what the frontend renders.

Every failure mode is a structured tool result, so the model self-corrects
within its remaining loop steps instead of failing the run.

### Dep surface changes

`AgentToolDeps` gains one method; `runSql`'s return type gains one field:

- `runSql` output includes `resultId` — the id of the auto-saved `table`
  artifact (web), or a runtime-local id like `"r1"` (TUI, evals). The model
  sees it in-context and echoes it into `presentData`.
- `getResultMeta(resultId)` returns `{ columns, rowCount } | null` — an
  artifact lookup in the web runtime, an in-memory map in the TUI and eval
  harness.

`createAgentTools` tracks the turn's `resultId`s in a closure (it defines the
`runSql` execute) to power the sole-result fallback.

### `saveArtifact` scope

`presentData` supersedes `chartSpec` artifacts. The `saveArtifact` tool narrows
to `finding` and `error`; `sql` and `table` remain auto-saved by `runSql`. The
`chartSpec` member stays in the artifact type union so existing rows
remain valid — no migration; legacy threads render through the old panel path.

## Rendering

### Inline placement

`splitParts` in `AssistantTurn` gains two changes:

- When scanning for the trailing run of text parts (the final answer), **skip
  `presentData` tool parts** — a view call placed after prose must not fold the
  answer back into the work block.
- `presentData` parts are **lifted out of the work list** into a `views` list,
  rendered between the work block and the final answer text, in stream order.
  They do not appear as dots on the work rail; they are product, not process.

The agent is instructed to call `presentData` before writing the final answer,
so the streaming order the user sees is: work block folds → view appears →
prose streams beneath it. A late call still renders correctly because of the
skip rule above.

### Data flow

The stream and the persisted message parts never carry full result rows
(`trimChunkForStream` caps `runSql` outputs at a ~20-row preview, and the loop
persists the trimmed chunks). Therefore:

- A new `artifacts.get(artifactId)` tRPC query (same ownership check as
  `listForRun`) serves full rows, up to the `runSql` cap (default 500).
- The inline `<DataView spec resultId>` component fetches rows reactively with
  that query and shows a skeleton while loading. This works identically for
  live streams and reopened historical threads.
- The view spec itself is small and rides untrimmed in the tool output part.

### Fallback behavior

`DataView` re-validates the spec with `viewSpec.safeParse` and falls back to
the plain result table when:

- the spec fails to parse (corrupt part, schema drift across deploys),
- a referenced column is missing from the fetched rows,
- the variant cannot plot the data (e.g. non-numeric measure).

A bad spec degrades to a table; it never renders a broken or empty chart.
While a `presentData` part is still `running` (input streaming), render
nothing — the view appears when the validated output arrives.

### Artifact panel

The panel's Chart tab renders `view` artifacts through the same `DataView`,
joining rows by `resultId` — retiring the `sourceSql` string-matching (and its
"fall back to the last table" behavior). Legacy `chartSpec` artifacts keep the
old matching path for existing threads.

## History Compaction

`buildToolLines` gains a `presentData` case:

```txt
presentData: bar "Stores by city" (x: city_name, y: store_count, result: <id>)
```

One line of context per view lets later turns handle "sort it descending" or
"show that as a line instead" — the model knows the prior spec and can reuse
the `resultId` without re-running SQL. Because artifacts are thread-scoped,
re-referencing an earlier turn's result is valid; `getResultMeta` checks
thread ownership, not run ownership.

## Parallel Runtimes

Three runtimes share the tool definitions and must stay in lockstep:

- **Demo mode** (`src/server/demo.ts`, the local default): emits the
  `presentData` chunk sequence (input-start → input-delta → input-available →
  output-available with a normalized spec and real artifact ids) and saves the
  `view` artifact, so the inline UI is demoable and testable offline.
- **TUI**: `runSql` returns local `resultId`s; `getResultMeta` reads an
  in-memory map; a successful `presentData` prints a line such as
  `[view: bar "Stores by city"]`.
- **Evals** (`evals/run.ts`): the `chartSaved` capability flips on a
  successful `presentData` call instead of a `chartSpec` artifact. This is the
  regression test for "does the agent choose to visualize when it should."

## Skills And Instructions

The `chart-selection` skill is rewritten around the new contract:

- the `presentData` input shape and the `resultId` convention,
- per-variant rules: `table` when exact rows matter; `bar` for rankings and
  grouped counts; `horizontal: true` when category labels are long; `stat` for
  single-scalar answers; `line` only over a real temporal column (this
  dataset's only one is `malls.opened_year` — do not fake time series);
  `scatter` only for genuine numeric-vs-numeric relationships, which this
  dataset rarely has,
- call `presentData` after the result exists (so columns are real) and before
  writing the final answer.

Base instructions gain one line: after a query result, decide whether a view
aids interpretation; scalar answers get `stat` or nothing.

## Storage Changes

- `artifactType` union: add `view`; keep `chartSpec` for legacy rows.
- `view` artifact payload: `{ view: ViewSpec, resultId, title }`, validated
  with the same schema shape used by the tool and renderer.
- New public query `artifacts.get(artifactId)` with the standard user/thread
  ownership check.

## Acceptance Criteria

- For a grouped/ranking question, the agent renders an appropriate chart
  inline between the work block and the answer, without being asked to chart.
- For a single-scalar question, the agent renders a `stat` view or no view —
  never a one-bar chart.
- A view survives refresh mid-stream and renders identically when the thread
  is reopened later.
- An invalid or unplottable spec renders as a plain result table, never a
  broken chart, and the run still completes.
- A model that emits a malformed `presentData` call gets a corrective tool
  error and can retry within the same run; the run does not abort.
- "Show that as a line instead" in a follow-up turn reuses the prior result
  without re-running SQL.
- Demo mode exercises the full inline-view path offline.
