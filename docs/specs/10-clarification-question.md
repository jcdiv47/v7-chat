# 10 Clarification Question Tool

Status: Planned (not started)  
Last updated: 2026-07-05

An `askUser` agent tool for human-in-the-loop clarification: when a request is
genuinely ambiguous, the agent asks one single-choice or multi-choice question,
the UI renders it as a dedicated interactive card, and the user's answer
(an option pick or a free-text "Other" reply) drives the next run.

## Core Decision: End The Run At The Question

Two possible shapes were considered:

1. **Pause mid-run** — the tool's `execute` blocks (polling an answers table)
   until the user answers, then the same run continues.
2. **End the run at the question** — the tool has **no `execute`**, so the
   `ToolLoopAgent` stops when the tool call has no result (the AI SDK's
   intended HITL pattern). The question becomes the final part of that
   assistant turn; the user's answer starts a fresh run that picks up context
   from compacted history.

**Decision: option 2.** Rationale, specific to this architecture:

- Runs execute as in-process promises (`src/server/run-worker.ts`) that
  heartbeat only at step boundaries. A tool `execute` blocked on a human who
  may answer in an hour (or never) stops heartbeating, so after
  `HEARTBEAT_STALE_MS` (120s) the sweeper or the next send would reclaim a
  healthy paused run as dead. The SDK-level `RUN_TIMEOUTS.totalMs` (10 min)
  bounds the whole run anyway, and a deploy/restart kills the in-process
  promise outright — a paused run survives none of these; an ended run costs
  nothing.
- `claimThreadForRun` (`src/server/runs-service.ts`), backstopped by the
  `one_live_run_per_thread` partial unique index, enforces one live run per
  thread. A paused run would lock the composer, the queued-message flow,
  retry, and edit for as long as the question sits unanswered.
- History is already rebuilt per run from compacted turns
  (`buildModelMessages`, `src/lib/agent/history.ts`), so "answer starts a new
  run" costs nothing: the
  question/answer pair becomes two more turns in history. This also makes
  "user ignores the question and types something else instead" work for free.

Consequences:

- No new run status. The run finishes `completed` with
  `finishReason: "tool-calls"` (the worker derives status from no-error /
  no-abort, independent of finish reason); the unanswered `askUser` tool part
  is captured in `reduced.parts` and persisted on the assistant message as
  usual. The "waiting for an answer" state is **derived on the client** (last
  message in the thread is an assistant turn whose trailing part is an
  unanswered `askUser`, and no run is live). This avoids touching the sweeper,
  `claimThreadForRun`, and every status switch.
- No schema migration. The question and its recorded answer live inside the
  existing `messages.parts` jsonb column (`src/server/db/schema.ts`).
- The stream reducer (`src/lib/agent/stream-parts.ts`) persists an unexecuted
  tool call as a `RenderToolPart` with `status: "running"` and no `output` —
  only a tool output flips it to `"done"`. So "unanswered" is precisely
  `status === "running"` on the stored part, and recording the answer must
  patch **both** `output` and `status: "done"`, or the work block's tool row
  pulses as running forever.

## Tool Contract

In `src/lib/agent/tools.ts`:

```ts
askUser: tool({
  description:
    "Ask the user ONE clarification question when the request is genuinely " +
    "ambiguous and the answer changes what you'd do. Prefer asking before " +
    "running queries, not after. Do not call any other tool in the same step.",
  inputSchema: z.object({
    question: z.string(),
    kind: z.enum(["single", "multi"]),
    options: z
      .array(
        z.object({
          label: z.string(),
          description: z.string().optional(),
        }),
      )
      .min(2)
      .max(5),
  }),
  // web runtime: no execute — the loop stops; the answer arrives as the next turn
})
```

Because tool definitions are shared with the TUI, `execute` is conditional on
the deps: `AgentToolDeps` gains an optional
`askUser?(input): Promise<AskUserAnswer>`. The web runtime omits it
(stop-and-wait); the TUI provides a synchronous readline prompt. Both runtimes
keep identical tool schemas.

The recorded answer shape (written into the part's `output` by the answer
mutation, and returned by the TUI implementation):

```ts
type AskUserAnswer = {
  answered: true;
  /** Labels of the chosen options (single-choice: length 1). Empty when the
   * user answered purely via free text. */
  selected: string[];
  /** Free-text "Other" reply, standalone or alongside selections. */
  otherText?: string;
};
```

## Answer Flow

One new tRPC mutation, `chat.answerQuestion`
(`src/server/trpc/routers/chat.ts`):

```
answerQuestion({ messageId, toolCallId, selected: string[], otherText?: string })
```

1. Validates: the message is the thread's latest, the `askUser` part matching
   `toolCallId` exists and is unanswered, at least one of
   `selected`/`otherText` is non-empty, and no live run exists (reusing the
   stale-run reclaim in `claimThreadForRun` so a stale run never blocks an
   answer).
2. Patches the stored assistant message's `askUser` part (a read-modify-write
   of the `messages.parts` jsonb inside the transaction) with the
   `AskUserAnswer` output and `status: "done"`, so the card renders as
   answered forever without deriving state from neighboring messages.
3. Inserts a user message whose `text` is a readable rendering of the answer
   (e.g. `Last 30 days`, `Selected: A, B`, or `Other: <free text>` — combined
   when both are present). History compaction feeds this to the model
   unchanged, so `buildModelMessages` needs no modification.
4. Creates the next run exactly like `chat.send` does, following the
   established transaction pattern: `assertNotDraining` → `lockThread` →
   `claimThreadForRun` → insert the answer message → `insertRun` →
   `appendEvent` (`run.started`), then after commit
   `publishRunEnd(reclaimedRunId)` and `startRun(runId)`, with
   `rethrowLiveRunConflict` on the transaction. The row-level helpers are
   already shared with `send`/`editAndRerun`/`retry`; no stream setup is
   needed (`run_chunks` rows appear lazily via the chunk writer).

## History Compaction

`buildToolLines` (`src/lib/agent/stream-parts.ts`) gains an `askUser` case that
includes the full question and options, e.g.:

```
askUser: "Which timeframe?" (single: Last 7 days | Last 30 days | All time)
```

The following user turn carries the answer, so on the next run the model sees a
coherent Q→A exchange. `toolLabel` gains a case too (`Asked a question` /
truncated question text) for the folded work-block row.

## UI Rendering

The wrinkle: `AssistantTurn.splitParts` treats everything before the trailing
text run as "work", so a trailing `askUser` part would fold into the WorkBlock.
Instead, peel a trailing `askUser` tool part off and render a dedicated
`QuestionCard` (`src/components/chat/QuestionCard.tsx`) below the work block /
final text.

Card states:

- **Pending** (interactive): only when it is the thread's latest message,
  unanswered, and no run is live. Radio buttons for `single`, checkboxes for
  `multi`, a free-text **"Other"** input (always shown; usable standalone or —
  for `multi` — alongside checked options), and a submit button that calls
  `answerQuestion`. Submit enabled when at least one option is selected or the
  Other field is non-empty.
- **Answered**: chosen options highlighted, Other text shown, controls
  disabled. Read from the patched part output.
- **Skipped**: unanswered but no longer answerable (a newer message exists) —
  rendered dimmed and disabled.

Streaming needs no special handling: the card appears when
`tool-input-available` arrives and the run finalizes immediately after, since
the loop stops at the call. The pending card renders from persisted message
parts (the run is already `completed`), so it survives refresh by
construction. `Conversation.tsx` passes the "is latest message + no live run"
flags and the `answerQuestion` callback down to `AssistantMessage` →
`AssistantTurn` ("no live run" comes from `runs.latestForThread`). After
submit, the answered state arrives via the existing `refreshThread`
invalidation pattern (`utils.messages.list.invalidate()` on mutation
success) — there is no reactive backend, so the refetch is what flips the
card.

## Instructions

`src/lib/agent/instructions.ts` gains guardrails: at most one question per
turn; only ask when the ambiguity actually changes the analysis; never re-ask
an answered question; prefer asking before running SQL rather than after.
Models overuse escape-hatch tools without this.

## Edge Cases

- **Parallel tool calls**: a model may emit `askUser` alongside `runSql`, or
  two `askUser` calls, in one step. With no `execute`, sibling tools still run
  and then the loop stops. The UI renders only the *last trailing* `askUser`
  as interactive; extra ones stay in the work block as inert rows. The prompt
  guardrail minimizes this.
- **User types instead of answering**: `chat.send` works unchanged; the card
  flips to Skipped. The unanswered question remains in history as a toolLine.
- **Edit/retry**: `editAndRerun` deletes trailing messages, discarding pending
  questions naturally. `chat.retry` after an answered question regenerates as
  usual. No changes needed.
- **Queued messages**: a question ends the run, so the queued-message dispatch
  in `Conversation.tsx` fires and the queued text becomes the de-facto answer
  turn; the card flips to Skipped. Acceptable V1 behavior.
- **Final step**: `prepareStep` (`src/lib/agent/run.ts`) disables all tools on
  the last allowed step, so the model can never end its final step on a
  question — it is forced to give a best-effort answer instead. Desirable;
  leave it.
- **Run events**: the `onToolExecutionStart/End` lifecycle callbacks never
  fire for an execute-less tool, so `askUser` produces no
  `tool.started`/`tool.finished` run_events. `toolCallCount` still counts it
  (incremented on `tool-input-available` in the worker). Acceptable
  observability gap.
- **Demo mode**: `MODEL_PROVIDER=mock` must exercise the card. Add a scripted
  question to `src/server/demo.ts` (triggered by a keyword such as
  "ambiguous") emitting the real chunk sequence. `runDemoAnalysis` currently
  never sees the user's message, so the trigger requires threading the user
  text through its options.

## Implementation Phases

Each phase is independently shippable and leaves the app working.

### Phase A: Tool Layer And Compaction

- `src/lib/agent/types.ts`: `AskUserInput` / `AskUserAnswer` types; optional
  `askUser` on `AgentToolDeps`.
- `src/lib/agent/tools.ts`: the `askUser` tool (execute only when deps provide
  it); add to `AGENT_TOOL_NAMES`.
- `src/lib/agent/stream-parts.ts`: `toolLabel` + `buildToolLines` cases.
- `src/lib/agent/instructions.ts`: usage guardrails.

Acceptance: with a real model, an ambiguous prompt yields a run that ends
`completed` / `finishReason: "tool-calls"` with a trailing unanswered `askUser`
part persisted on the message; `buildToolLines` emits the documented line.

### Phase B: Answer Mutation

- `src/server/trpc/routers/chat.ts`: add `answerQuestion` per the flow above,
  reusing the existing shared helpers (`lockThread`, `claimThreadForRun`,
  `insertRun`).

Acceptance: calling `answerQuestion` patches the part, inserts the rendered
user message, and starts a run whose model context contains the Q→A exchange;
answering a non-latest message or an already-answered question is rejected; a
stale run does not block answering.

### Phase C: Frontend Card

- `src/components/chat/QuestionCard.tsx`: the three-state card with single /
  multi / Other input.
- `src/components/chat/AssistantTurn.tsx`: peel the trailing `askUser` part
  out of the work split.
- `src/components/chat/Conversation.tsx`: latest-message + no-live-run flags,
  `answerQuestion` wiring.

Acceptance: the card streams in live, survives refresh, renders answered state
after submit (including Other-only answers), and shows Skipped when the user
types past it. A question mid-history renders correctly on thread reopen.

### Phase D: Demo Mode, TUI, Evals

- `src/server/demo.ts`: scripted question path (thread the user's message
  text into `runDemoAnalysis` for the keyword trigger).
- `tui/index.ts`: readline-based `askUser` dep.
- `evals/`: a prompt asserting the agent asks (not guesses) on a genuinely
  ambiguous request, and one asserting it does *not* ask on a clear request.

Acceptance: demo mode exercises the full pending → answered cycle without a
model provider; TUI answers inline; both eval prompts pass.

## Out Of Scope (Later)

- Multiple questions per turn / question queues.
- A dedicated `awaiting_input` run status (revisit only if product needs
  timeout-and-proceed behavior).
- Timeout or default-answer semantics for abandoned questions.
- Special rendering of the user's answer bubble (chip-style); V1 renders the
  plain-text answer message.
