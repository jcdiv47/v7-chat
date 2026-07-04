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
- Entry point for account and settings.
- V1 renders a static placeholder identity (single anonymous user, no login); this
  footer becomes the Clerk account entry point in V2.

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

This is the core interaction behavior. A single assistant turn interleaves three kinds of content — reasoning (thinking), tool
calls, and the final response — and moves through a live phase and a folded phase.

### Live Phase (while streaming)

- **Thinking tokens stream visibly.** As the agent emits reasoning, show it in a live,
  muted "thinking" block so the user sees the model working.
- **Tool calls render as they happen.** Each tool call appears as a compact summary row
  with a leading icon, a human-readable label, and a live status (running → done →
  error). Examples of labels: `Searched code and listed files`, `Read 4 files`,
  `Listed files, ran a command`.
- Adjacent tool calls of the same kind may collapse into one summarized row
  (e.g. `Read 4 files`).
- **Streaming survives refresh.** The live view is driven by run state in Convex, not
  by the HTTP response alone; see "Refresh And Reattach" below.

### Folded Phase (after the step completes)

- **Thinking folds up** into a single collapsed header summarizing the effort, e.g.
  `Worked for 31s ⌄`. Expanding it reveals the streamed reasoning.
- **Tool calls fold** into their compact summary rows. Each row is expandable to reveal
  detail: the specific files read, the command run, arguments, and a result preview.
- **The final response then streams** as normal assistant text below the folded blocks.

### Interleaving

Within one turn the order can be: thinking → tool group → intermediate text → thinking →
tool group → final answer. Preserve this interleaving; do not reorder parts. Group
consecutive tool calls, but keep intermediate assistant text between groups where the
agent produced it.

### Refresh And Reattach

Streaming is resumable (see `01-system-architecture.md` → Resumable Streaming):

- On thread load, if the latest run is still `running`, render it in the live phase:
  decode the persisted stream body into parts to rebuild the in-progress thinking
  block, tool rows, and text, then continue appending from the Convex subscription.
- No content is duplicated or lost across the refresh; part order matches the original
  stream.
- The composer stays in the streaming state: send remains a stop control, and stop
  still cancels the server-side run.
- When the run finishes — whether or not this tab watched it live — the thinking block
  and tool rows fold as normal and the final response is intact.
- If a `running` run's heartbeat is stale (the server died mid-run), render it as
  failed with its partial output and offer retry.

### Mapping To AI SDK V7 UI Message Parts

The renderer is driven by the ordered `parts` of each streamed assistant UI message:

- `reasoning` parts → thinking block (live), then the `Worked for Ns` folded summary.
- `tool-*` / dynamic tool parts → tool-call rows. Use the part state to drive status:
  `input-streaming` / `input-available` → running, `output-available` → done,
  `output-error` → error. Render inputs (files, command, SQL) and an output summary in
  the expanded view. Streamed tool parts carry only compact output summaries; the
  expanded view fetches the full result preview from the run's artifacts/events.
- `text` parts → assistant prose, including the final response.

The frontend should preserve, per message: assistant text, reasoning, tool call state
and results summaries, artifact references, and final response metadata.

## Domain Artifacts

Analysis outputs are first-class but live inside the chat-first design.

- **Inline in the conversation:** SQL blocks (copyable), compact result tables, and
  charts render inline as rich blocks within the assistant message.
- **Artifact panel (on-demand):** clicking an artifact reference — or the `Artifacts`
  nav item — opens the right-side panel. Within a given artifact the panel exposes tabs:

  - `Answer`
  - `SQL`
  - `Table`
  - `Chart`
  - `Run Events` (behind a developer/debug toggle in V1)

### Result Table

- stable columns
- row count and truncation indicator
- copy SQL button
- basic sorting if cheap
- horizontal scrolling for wide results

### Chart View

- render chart spec from agent output
- show table fallback when the chart spec is missing or invalid
- expose the underlying SQL
- Recharts is the pragmatic default (shadcn/ui has examples)

## AI SDK UI Integration

Use AI SDK UI message parts as the rendering contract. The Convex HTTP action streams
agent UI messages from the `ToolLoopAgent` — reasoning, tool, and text parts encoded as
JSON lines — through `@convex-dev/persistent-text-streaming`. The client wraps the
component's `useStream` hook: the initiating tab consumes the HTTP stream
(`driven: true`), while a refreshed or second tab reads the persisted body reactively;
the wrapper decodes JSONL back into parts and feeds the same renderer, so the live →
folded lifecycle works identically in both cases.

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
- Show the agent working: stream thinking and tool calls, then fold them cleanly.
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
      label: string; // human-readable summary, e.g. "Read 4 files"
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
  type: "sql" | "table" | "chartSpec" | "finding" | "error";
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
- During a run, thinking tokens and tool calls stream live, then fold into a
  `Worked for Ns` summary and compact tool-call rows before the final response streams.
- User can expand a folded thinking block or tool-call row to see detail.
- Refreshing the browser mid-run reattaches to the live run: thinking, tool calls, and
  the answer keep streaming, with no duplicated or missing content, and stop still
  works.
- User can ask a question and see a streamed answer.
- User can inspect the SQL used, the tabular results, and a basic chart for
  grouped/ranking questions.
- User can revisit prior sessions and prior runs within a session.
- UI remains usable when SQL fails or returns no rows.
