# 05 Frontend UX

## Design Direction

V1 uses a Claude-like, chat-first design. The conversation is the primary surface. The
UI is calm, readable, and content-focused: generous spacing, a restrained neutral
palette, clear typographic hierarchy, and full light/dark support.

This is a chat product, not a landing page and not a dense operational dashboard. Domain
outputs (SQL, tables, charts, findings) still matter, but they render inside the
conversation and in an on-demand artifact panel rather than in an always-on third column.

## Primary Layout

Two persistent regions plus an on-demand panel:

```txt
-----------------------------------------------------------------
| Sidebar        | Conversation                    | Artifact    |
|                |                                  | (on-demand) |
| new chat       | top bar: title / share / panel   |             |
| primary nav    |                                  | SQL         |
| pinned         | message stream                   | Table       |
| recents        |   user bubbles                   | Chart       |
|                |   assistant text                 | Findings    |
|                |   thinking (folds)               |             |
|                |   tool calls (fold)              |             |
| account/plan   | composer                         |             |
-----------------------------------------------------------------
```

- The sidebar is collapsible; collapsing widens the conversation.
- The artifact panel is closed by default and opens when the user clicks an artifact
  reference in a message or the `Artifacts` nav item. It slides in over the right edge
  and can be pinned open on wide screens.
- On small screens: the sidebar becomes a drawer, and the artifact panel becomes a full
  sheet. The conversation is always primary.

## Sidebar

The sidebar organizes navigation and session history into sections, top to bottom.

### Header

- App wordmark/logo.
- Search trigger (opens the global search modal; see below).
- Sidebar collapse / expand toggle.

### New Chat

- Prominent `New chat` action at the top, always visible.

### Primary Nav

- `Chats`
- `Projects`
- `Artifacts`
- `Customize`

Keep the set small in V1. `Projects` and `Customize` may be stubs if not yet built, but
the slots should exist so the layout matches the target design.

### Session Sections

Sessions are grouped into labeled sections:

- **Pinned / Starred** — sessions the user explicitly pins. Persisted per user. Shown
  above recents so important analyses stay reachable.
- **Recents** — recent sessions in reverse-chronological order. The header may carry a
  small filter/sort affordance.

Each session row shows:

- the session title (truncated with ellipsis),
- the active session highlighted,
- an overflow (`…`) menu on hover/focus with: `Pin`/`Unpin`, `Rename`, `Delete`, and
  optionally `Share`.

### Footer

- User avatar, name/handle, and plan/account indicator.
- Entry point for the Clerk account menu and settings.

## Global Search Modal

A command-palette-style search over sessions and projects.

Requirements:

- Opens from the sidebar search trigger and a keyboard shortcut (`Cmd/Ctrl+K`).
- Centered modal over a dimmed backdrop; closes on `Esc`, backdrop click, or the `X`.
- Single search input (`Search chats and projects`) with a leading search icon.
- Results are a scrollable list; each row has a leading icon, the session/project title,
  and a right-aligned recency label (e.g. `Today`, `Past week`, `Past month`).
- Fuzzy match on title; empty query shows recent sessions.
- Full keyboard control: arrow keys move selection, the highlighted row shows a `↵`
  hint, and `Enter` opens it.

## Conversation View

### Message Stream

- **User messages** render as right-aligned bubbles.
- **Assistant messages** render as flowing text (no bubble): markdown with headings,
  ordered/unordered lists, code blocks, and inline code chips (monospace with a subtle
  background). File and artifact references render as clickable links, optionally with a
  small type icon and location (e.g. `src/lib/agent/instructions.ts (line 1)`).
- Streaming assistant text appends live.
- A scroll-to-bottom affordance appears when the user has scrolled up during streaming.
- Per-message actions on hover: copy, retry, and (for a run) stop.
- Retry starts a new run for the same user message and appends the new response; the
  previous assistant response stays in history (no message versioning in V1).

### Composer

- Multiline textarea with a placeholder (`Write a message…`).
- `Enter` sends, `Shift+Enter` inserts a newline.
- Model / effort selector.
- Attach action slot (`+`).
- Send toggles to a stop control while a run is streaming. One run per thread at a
  time: sending is blocked while a run is live.
- Stop takes effect at the next agent step boundary (up to one model generation of
  latency); the UI shows a stopping state immediately.

### Empty State

The empty state offers example questions as clickable suggestion chips, not marketing:

- "How many malls are in each city?"
- "Which malls have the most stores?"
- "Are there malls with no stores?"
- "Compare store counts across cities."

## Thinking And Tool-Call Rendering

This is the core interaction behavior. A single assistant turn interleaves three kinds
of content — reasoning (thinking), tool calls, and the final response. Everything
except the final response renders inside one collapsible **work block** per turn.

### The Work Block

- All of a turn's work — reasoning, tool calls, and any intermediate text the model
  emitted between tool calls — renders inside a single collapsible block, in stream
  order, as a timeline along a vertical rail.
- The block header is the fold control. While the agent is still reasoning or calling
  tools it shows a spinner and `Working…`; once the final answer starts it shows
  `Worked for Ns`. The duration freezes the moment work completes, so the header stays
  stable while the answer streams.
- Reasoning and intermediate text render as muted prose on the rail.
- Each tool call is a dot on the rail with a status color (running → done → error) and
  a human-readable label derived from the tool and its input, e.g.
  `Loaded skill mall-domain-analysis`, `Described malls`, `Ran SQL query`. Tool calls
  are not grouped; each call is its own row. A row expands in place to reveal detail:
  arguments, the SQL, and a result preview.
- **Streaming survives refresh.** The live view is driven by persisted run
  chunks plus the tRPC SSE stream, not by the initiating HTTP response alone;
  see "Refresh And Reattach" below.

### Open / Collapsed Lifecycle

- **While working**, the block is open and streams reasoning, tool rows, and
  intermediate text as they arrive.
- **When the final answer starts**, the block collapses to `Worked for Ns` and the
  answer streams below it as normal assistant text.
- A manual toggle on the header overrides the automatic state in either direction,
  both live and for completed turns.

### What Counts As The Final Answer

The final answer is the **trailing run of `text` parts** in the turn, rendered as
markdown below the work block. While streaming, a text part is treated as final as
soon as it starts; if a later tool call arrives, that text retroactively becomes
intermediate work and folds back into the block. Two exceptions to the trailing
scan:

- `presentData` parts are **skipped** when finding the trailing run — a view call
  placed after prose must not fold the answer back into the work block.
- A consequence to preserve for other tools: when the model ends its turn with a
  tool call (e.g. saving a finding after writing its answer), the answer text
  lives inside the work block and the turn renders no prose below the fold.

`presentData` parts are also **lifted out of the work block** entirely: they render
as inline data views between the work block and the final answer, in stream order,
and do not appear as dots on the work rail. See "Inline Data Views" below and
`08-generative-ui.md`.

### Interleaving

Within one turn the order can be: thinking → tool calls → intermediate text → thinking →
tool calls → final answer. Preserve this interleaving inside the work block; do not
reorder parts.

### Refresh And Reattach

Streaming is resumable (see `01-system-architecture.md` → Resumable Streaming):

- On thread load, if the latest run is still `running`, render it in the live phase:
  decode the persisted stream body into parts to rebuild the in-progress work block
  and any final text, then continue appending from the tRPC SSE subscription.
- No content is duplicated or lost across the refresh; part order matches the original
  stream.
- The composer stays in the streaming state: send remains a stop control, and stop
  still cancels the server-side run.
- When the run finishes — whether or not this tab watched it live — the work block
  folds as normal and the final response is intact.
- If a `running` run's heartbeat is stale (the server died mid-run), render it as
  failed with its partial output and offer retry.

### Mapping To AI SDK V7 UI Message Parts

The renderer is driven by the ordered `parts` of each streamed assistant UI message:

- `reasoning` parts → muted prose inside the work block.
- `tool-*` / dynamic tool parts → tool rows on the work-block rail. Use the part state
  to drive status: `input-streaming` / `input-available` → running,
  `output-available` → done, `output-error` → error. Render inputs (SQL, arguments)
  and an output summary in the expanded view. Streamed tool parts carry only compact
  output summaries; the expanded view fetches the full result preview from the run's
  artifacts/events.
- `text` parts → the trailing run is the final answer below the block; any earlier
  text renders inside the work block as intermediate work.
- `presentData` tool parts → inline data views (not work rows). Render only from
  the tool's `output` (the validated, normalized spec); while the part is still
  running, render nothing. See `08-generative-ui.md`.

The frontend should preserve, per message: assistant text, reasoning, tool call state
and results summaries, artifact references, and final response metadata.

## Domain Artifacts

Analysis outputs are first-class but live inside the chat-first design.

- **Inline in the conversation:** data views the agent chose to present (tables,
  charts, stat callouts) render inline between the work block and the answer; SQL
  and full result previews stay behind tool rows and the artifact panel.
- **Artifact panel (on-demand):** clicking an artifact reference — or the `Artifacts`
  nav item — opens the right-side panel. Within a given artifact the panel exposes tabs:

  - `Answer`
  - `SQL`
  - `Table`
  - `Chart`
  - `Run Events` (behind a developer/debug toggle in V1)

### Inline Data Views

The `<DataView>` component renders a validated view spec (`08-generative-ui.md`)
against a referenced query result:

- **Rows come from persisted artifacts, not the stream.** Streamed and
  persisted tool parts carry only a ~20-row preview; `DataView` fetches full
  rows (up to the `runSql` cap) reactively via `artifacts.get(resultId)`, with
  a skeleton while loading. This makes live streams and reopened historical
  threads render identically.
- **Table fallback, always.** The spec is re-validated with the shared Zod schema
  at render time; on parse failure, a missing column, or an unplottable variant,
  the view degrades to the plain result table — never a broken or empty chart.
- One view per `presentData` call; multiple calls in a turn stack in stream order.

### Result Table

- stable columns
- row count and truncation indicator
- copy SQL button
- basic sorting if cheap
- horizontal scrolling for wide results

### Chart View

- the panel's Chart tab renders `view` artifacts through the same `DataView` as
  the inline path, joining rows by `resultId` (no SQL-string matching)
- legacy `chartSpec` artifacts keep the old source-SQL matching render path
- show table fallback when the view spec is missing or invalid
- expose the underlying SQL
- Recharts is the pragmatic default (shadcn/ui has examples)

## AI SDK UI Integration

Use AI SDK UI message parts as the rendering contract. The in-process worker
streams agent UI messages from the `ToolLoopAgent` — reasoning, tool, and text
parts encoded as JSON lines — through the RunBus and persisted `run_chunks`.
Every tab (initiating, refreshed, or second) reads through the cursor-based
`runs.stream` tRPC SSE subscription; the client decodes JSONL back into parts
and feeds the same renderer, so the live → folded lifecycle works identically
everywhere.

## shadcn/ui Components

Recommended components:

- `Button`
- `Textarea` / `Input`
- `Command` (global search modal)
- `Dialog` (modal shell)
- `Collapsible` / `Accordion` (thinking and tool-call folding)
- `ScrollArea`
- `Sheet` (mobile sidebar drawer and artifact panel)
- `ResizablePanelGroup` (artifact panel on wide screens)
- `Tabs` (artifact panel)
- `Table`
- `Avatar`
- `Badge`
- `Separator`
- `DropdownMenu` (session overflow menu)
- `Tooltip`
- `Skeleton`
- `Alert`

Use icons for common actions: search, new chat, pin, copy, retry, stop, expand,
collapse, download.

## Design Principles

- Chat-first and content-focused; the conversation leads.
- Calm and readable: generous spacing, restrained neutral palette, clear hierarchy.
- Full light and dark support.
- Show the agent working: stream thinking and tool calls in the work block, then fold
  it cleanly.
- Keep SQL visible and copyable.
- Do not hide uncertainty; show caveats.
- Avoid decorative cards and marketing patterns.

## View Models

Session list item (sidebar and search):

```ts
type SessionListItem = {
  id: string;
  threadId: string;
  title: string;
  pinned: boolean;
  updatedAt: number;
  recencyBucket: "today" | "pastWeek" | "pastMonth" | "older";
};
```

Assistant message parts (drives thinking / tool / text rendering):

```ts
type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string; durationMs?: number }
  | {
      kind: "tool";
      name: string;
      label: string; // human-readable summary, e.g. "Ran SQL query", "Described malls"
      status: "running" | "done" | "error";
      input?: unknown;
      outputSummary?: string;
    };
```

Artifact:

```ts
type ArtifactViewModel = {
  id: string;
  runId: string;
  type: "sql" | "table" | "view" | "finding" | "error" | "chartSpec"; // chartSpec is legacy
  title: string;
  createdAt: number;
  preview?: string;
};
```

## V1 Acceptance Criteria

- The shell matches the reference: sidebar with pinned and recent sessions, a
  conversation column, and an on-demand artifact panel.
- User can open a global search modal, search chats/projects, and open a result via
  keyboard or click.
- User can pin/unpin, rename, and delete sessions from the sidebar.
- During a run, thinking tokens and tool calls stream live inside an open work block,
  which collapses into a `Worked for Ns` summary when the final response starts.
- User can expand a collapsed work block, and tool rows within it, to see detail.
- Refreshing the browser mid-run reattaches to the live run: thinking, tool calls, and
  the answer keep streaming, with no duplicated or missing content, and stop still
  works.
- User can ask a question and see a streamed answer.
- User can inspect the SQL used, the tabular results, and a basic chart for
  grouped/ranking questions.
- For grouped/ranking questions the agent presents an inline chart on its own,
  rendered between the work block and the answer; the view survives refresh
  mid-stream and reopening the thread later.
- An invalid or unplottable view spec degrades to a plain result table without
  failing the run.
- User can revisit prior sessions and prior runs within a session.
- UI remains usable when SQL fails or returns no rows.
