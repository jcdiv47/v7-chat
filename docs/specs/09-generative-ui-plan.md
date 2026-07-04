# 09 Generative UI Implementation Plan

Implements `08-generative-ui.md`. Phases are ordered by dependency; each is
independently shippable and leaves the app working. File references point at
today's layout.

## Phase A: View Spec And Tool Layer

The shared, runtime-agnostic core everything else consumes.

Deliverables:

- `src/lib/agent/ui-spec.ts`: the `viewSpec` discriminated union, the
  permissive flat input shape, and a `normalizeViewInput` helper (flat input →
  strict spec candidate).
- `src/lib/agent/types.ts`: `runSql` output gains `resultId`; `AgentToolDeps`
  gains `getResultMeta(resultId)`; `ChartSpec` moves to a clearly-marked legacy
  export (still needed by the legacy panel render path).
- `src/lib/agent/tools.ts`: the `presentData` tool — permissive `inputSchema`,
  `execute` pipeline (normalize → strict parse → resolve result with
  sole-result fallback → column check → save `view` artifact → return
  normalized spec). `saveArtifact` narrows to `finding` / `error`. A closure in
  `createAgentTools` tracks the turn's `resultId`s for the fallback.
- `src/lib/agent/stream-parts.ts`: `toolLabel` and `buildToolLines` cases for
  `presentData` (one-line summary with view type, title, columns, `resultId`).

Acceptance criteria:

- Every invalid input (bad variant, unknown `resultId`, missing column)
  returns a structured `{ ok: false, error }` tool result; nothing throws.
- A valid call returns `{ ok: true, viewId, resultId, view }` with the
  normalized spec.
- `buildToolLines` emits the documented one-line summary.
- Unit-testable without Convex or Postgres (deps mocked).

## Phase B: Web Runtime Wiring

Deliverables:

- `convex/schema.ts`: add `view` to `artifactType` (keep `chartSpec` for
  legacy rows); validator for the `view` payload `{ view, resultId, title }`.
- `convex/artifacts.ts`: public `get(artifactId)` query with the standard
  ownership check.
- `convex/agent/webDeps.ts`: `runSql` returns the auto-saved table artifact's
  id as `resultId`; implement `getResultMeta` (artifact lookup, thread-scoped
  so cross-turn references work).
- `convex/agent/demo.ts`: emit the full `presentData` chunk sequence with real
  artifact ids and save the `view` artifact, so demo mode
  (`MODEL_PROVIDER=mock`) exercises the inline path.

Acceptance criteria:

- A demo-mode run produces a `view` artifact whose `resultId` resolves via
  `artifacts.get` to the matching table artifact.
- `presentData` output chunks survive `trimChunkForStream` untouched (no rows
  array), and persisted parts carry the full normalized spec.
- Legacy `chartSpec` rows still pass schema validation.

## Phase C: Frontend Rendering

Deliverables:

- `src/components/artifacts/DataView.tsx`: renders a validated spec against
  rows fetched reactively via `artifacts.get(resultId)`; skeleton while
  loading; table fallback on parse failure, missing column, or unplottable
  data.
- `src/components/artifacts/Chart.tsx`: extend to the union — `horizontal` as
  a bar option, multi-series line, scatter, stat callout; `sort` / `limit` /
  `format` handling. Follow the dataviz mark specs already applied.
- `src/components/chat/AssistantTurn.tsx`: `splitParts` skips `presentData`
  parts in the trailing-text scan and lifts them into a `views` list rendered
  between the work block and the final answer, in stream order; running parts
  render nothing.
- `src/components/artifacts/ArtifactPanel.tsx`: Chart tab renders `view`
  artifacts through `DataView` joined by `resultId`; legacy `chartSpec`
  artifacts keep the `sourceSql`-matching path.

Acceptance criteria:

- A view streams in live, survives a mid-stream refresh, and renders
  identically when the thread is reopened.
- A `presentData` call placed after the answer prose does not fold the answer
  into the work block.
- A hand-corrupted spec (edit the artifact) renders as a plain table, not a
  broken chart.
- The panel Chart tab shows the same view as the inline render, including for
  multi-query runs (no "last table" fallback).

## Phase D: Skills, Instructions, TUI, Evals

Deliverables:

- `agent-skills/chart-selection/SKILL.md` rewritten around the `presentData`
  contract: input shape, `resultId` convention, per-variant rules (`stat` for
  scalars; no fake time series; scatter only for real numeric-vs-numeric).
- `src/lib/agent/instructions.ts`: one line — after a query result, decide
  whether a view aids interpretation; call `presentData` before the final
  answer.
- `tui/index.ts` deps: local `resultId`s (`r1`, `r2`, …), in-memory
  `getResultMeta`, print `[view: bar "Stores by city"]` on success.
- `evals/run.ts` + `evals/prompts.ts`: `chartSaved` capability flips on a
  successful `presentData` call; add prompts covering "chooses stat for a
  scalar" and "charts a ranking unprompted".

Acceptance criteria:

- With a real model, a grouped/ranking question yields an inline chart without
  being asked; a scalar question yields `stat` or no view.
- "Show that as a line instead" in a follow-up turn reuses the prior
  `resultId` without re-running SQL.
- TUI answers render a view line; evals pass with the selected OpenRouter
  models.

## Out Of Scope (Later)

- Migrating or backfilling legacy `chartSpec` artifacts (legacy render path
  covers them indefinitely at zero cost).
- New view types beyond the initial five (each is one union member + one
  renderer case when needed).
- A `generateObject` repair pass for specs the model fails to correct within
  its loop steps.
- Downsampling strategies beyond `limit` for large results.
