/**
 * The wire format for resumable streaming. The agent's AI SDK UI message stream
 * is encoded as JSONL (one JSON `UIMessageChunk` per line), published on the
 * RunBus, and persisted to `run_chunks`. Every tab — initiating, refreshed, or
 * second — reads the same lines over the `runs.stream` SSE subscription and
 * folds them into the render view model here, so the live → folded lifecycle
 * is identical. See docs/specs/01-system-architecture.md and
 * docs/specs/05-frontend-ux.md.
 *
 * Import-safe on the client (type-only import from `ai`).
 */
import type { UIMessageChunk } from "ai";
import { normalizeAskUserAnswers, normalizeAskUserQuestions } from "./types";
import type { PresentDataOutput } from "./ui-spec";

/** Rows kept in a runSql tool-output part *in the stream* (the small preview).
 * The full preview lives in the run's artifacts/events, fetched on expand. */
export const STREAM_PREVIEW_ROWS = 20;

// ---------------------------------------------------------------------------
// Encoding (server side)
// ---------------------------------------------------------------------------

/** Serialize one UI message chunk as a JSONL line, trimming bulky tool output. */
export function encodeChunk(chunk: UIMessageChunk): string {
  return JSON.stringify(trimChunkForStream(chunk)) + "\n";
}

/** Trim a chunk before it goes on the wire. runSql outputs can carry up to
 * `maxRows` rows; the stream only needs a ~20-row preview. */
export function trimChunkForStream(chunk: UIMessageChunk): UIMessageChunk {
  if (chunk.type !== "tool-output-available") return chunk;
  const output = chunk.output as unknown;
  if (
    output &&
    typeof output === "object" &&
    Array.isArray((output as { rows?: unknown }).rows)
  ) {
    const o = output as { rows: unknown[]; [k: string]: unknown };
    if (o.rows.length > STREAM_PREVIEW_ROWS) {
      return {
        ...chunk,
        output: {
          ...o,
          rows: o.rows.slice(0, STREAM_PREVIEW_ROWS),
          streamPreviewRows: STREAM_PREVIEW_ROWS,
          streamTrimmed: true,
        },
      };
    }
  }
  return chunk;
}

// ---------------------------------------------------------------------------
// Decoding (client side)
// ---------------------------------------------------------------------------

/** Parse a persisted stream body (concatenated JSONL) into chunks. A trailing
 * partial line (mid-append) is ignored until its newline arrives. */
export function parseStreamBody(text: string): UIMessageChunk[] {
  if (!text) return [];
  const chunks: UIMessageChunk[] = [];
  const lines = text.split("\n");
  // The last element is either "" (clean trailing newline) or an incomplete line.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (i === lines.length - 1 && !text.endsWith("\n")) break; // incomplete tail
    try {
      chunks.push(JSON.parse(line) as UIMessageChunk);
    } catch {
      // Skip a corrupt/incomplete line; the next reactive update will include it.
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Render view model
// ---------------------------------------------------------------------------

export type RenderTextPart = { kind: "text"; id: string; text: string };
export type RenderReasoningPart = {
  kind: "reasoning";
  id: string;
  text: string;
  done: boolean;
};
export type RenderToolPart = {
  kind: "tool";
  toolCallId: string;
  name: string;
  inputText?: string;
  input?: unknown;
  status: "running" | "done" | "error";
  output?: unknown;
  errorText?: string;
};
export type RenderPart = RenderTextPart | RenderReasoningPart | RenderToolPart;

export type ReducedMessage = {
  parts: RenderPart[];
  finished: boolean;
  finishReason?: string;
  errorText?: string;
  aborted: boolean;
};

/** Incremental chunk folder: `fold` does O(1) work per chunk (this is what
 * makes live streaming smooth — the client never re-reduces the whole body),
 * `snapshot` returns a render-safe copy of the current state. */
export type StreamReducer = {
  fold(chunk: UIMessageChunk): void;
  snapshot(): ReducedMessage;
};

export function createStreamReducer(): StreamReducer {
  const parts: RenderPart[] = [];
  const textIndex = new Map<string, number>();
  const reasoningIndex = new Map<string, number>();
  const toolIndex = new Map<string, number>();
  let finished = false;
  let finishReason: string | undefined;
  let errorText: string | undefined;
  let aborted = false;

  const ensureTool = (toolCallId: string, name = "tool"): RenderToolPart => {
    const existing = toolIndex.get(toolCallId);
    if (existing != null) return parts[existing] as RenderToolPart;
    const part: RenderToolPart = { kind: "tool", toolCallId, name, status: "running" };
    toolIndex.set(toolCallId, parts.length);
    parts.push(part);
    return part;
  };

  const fold = (chunk: UIMessageChunk): void => {
    switch (chunk.type) {
      case "text-start": {
        if (!textIndex.has(chunk.id)) {
          textIndex.set(chunk.id, parts.length);
          parts.push({ kind: "text", id: chunk.id, text: "" });
        }
        break;
      }
      case "text-delta": {
        let idx = textIndex.get(chunk.id);
        if (idx == null) {
          idx = parts.length;
          textIndex.set(chunk.id, idx);
          parts.push({ kind: "text", id: chunk.id, text: "" });
        }
        (parts[idx] as RenderTextPart).text += chunk.delta;
        break;
      }
      case "reasoning-start": {
        if (!reasoningIndex.has(chunk.id)) {
          reasoningIndex.set(chunk.id, parts.length);
          parts.push({ kind: "reasoning", id: chunk.id, text: "", done: false });
        }
        break;
      }
      case "reasoning-delta": {
        let idx = reasoningIndex.get(chunk.id);
        if (idx == null) {
          idx = parts.length;
          reasoningIndex.set(chunk.id, idx);
          parts.push({ kind: "reasoning", id: chunk.id, text: "", done: false });
        }
        (parts[idx] as RenderReasoningPart).text += chunk.delta;
        break;
      }
      case "reasoning-end": {
        const idx = reasoningIndex.get(chunk.id);
        if (idx != null) (parts[idx] as RenderReasoningPart).done = true;
        reasoningIndex.delete(chunk.id);
        break;
      }
      case "text-end": {
        textIndex.delete(chunk.id);
        break;
      }
      case "start-step": {
        // Providers can reuse per-step part ids (e.g. kimi via openai-compatible
        // emits "txt-0"/"reasoning-0" on every step). Retiring ids at step
        // boundaries and part ends keeps a later step's text a separate part,
        // in stream order after the step's tool calls — which is what lets the
        // UI split trailing final text out of the work block.
        textIndex.clear();
        reasoningIndex.clear();
        break;
      }
      case "tool-input-start": {
        const part = ensureTool(chunk.toolCallId, chunk.toolName);
        part.name = chunk.toolName;
        part.inputText = part.inputText ?? "";
        break;
      }
      case "tool-input-delta": {
        const part = ensureTool(chunk.toolCallId);
        part.inputText = (part.inputText ?? "") + chunk.inputTextDelta;
        break;
      }
      case "tool-input-available": {
        const part = ensureTool(chunk.toolCallId, chunk.toolName);
        part.name = chunk.toolName;
        part.input = chunk.input;
        break;
      }
      case "tool-output-available": {
        const part = ensureTool(chunk.toolCallId);
        part.status = "done";
        part.output = chunk.output;
        break;
      }
      case "tool-output-error": {
        const part = ensureTool(chunk.toolCallId);
        part.status = "error";
        part.errorText = chunk.errorText;
        break;
      }
      case "tool-input-error": {
        // Invalid tool input that repair couldn't fix: the call never executes,
        // so treat it like an execution error or the part pulses forever.
        const part = ensureTool(chunk.toolCallId, chunk.toolName);
        part.name = chunk.toolName;
        part.input = chunk.input;
        part.status = "error";
        part.errorText = chunk.errorText;
        break;
      }
      case "error": {
        errorText = chunk.errorText;
        break;
      }
      case "abort": {
        aborted = true;
        finished = true;
        break;
      }
      case "finish": {
        finished = true;
        finishReason = chunk.finishReason;
        break;
      }
      default:
        break;
    }
  };

  return {
    fold,
    snapshot(): ReducedMessage {
      // Fresh array reference so React re-renders; part objects are shared
      // (mutated in place), which the render tree tolerates — it walks parts
      // on every update rather than memoizing on part identity.
      return { parts: [...parts], finished, finishReason, errorText, aborted };
    },
  };
}

/** Fold an ordered list of chunks into render parts, preserving interleaving.
 * Used for finalized bodies; live streaming folds incrementally instead. */
export function reduceChunks(chunks: UIMessageChunk[]): ReducedMessage {
  const reducer = createStreamReducer();
  for (const chunk of chunks) reducer.fold(chunk);
  return reducer.snapshot();
}

/** Byte budget for the `parts` array stored on an assistant message, so one
 * pathological run can't balloon a message row (the row also carries `text`,
 * derived from the text parts, plus tool lines). Full-fidelity tool outputs
 * live in artifacts. */
export const MESSAGE_PARTS_BYTE_BUDGET = 400_000;

const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * Shrink parts to fit the storage budget, degrading least-valuable data first:
 * bulky tool outputs (full previews live in artifacts), then reasoning text,
 * then intermediate text parts — keeping the final answer intact if possible.
 */
export function capPartsForStorage(
  parts: RenderPart[],
  maxBytes = MESSAGE_PARTS_BYTE_BUDGET,
): RenderPart[] {
  if (jsonBytes(parts) <= maxBytes) return parts;

  let capped: RenderPart[] = parts.map((p) =>
    p.kind === "tool" && p.output != null
      ? { ...p, output: { truncatedForStorage: true }, inputText: undefined }
      : p,
  );
  if (jsonBytes(capped) <= maxBytes) return capped;

  capped = capped.map((p) =>
    p.kind === "reasoning" && p.text
      ? { ...p, text: "(reasoning omitted — too large to store)" }
      : p,
  );
  if (jsonBytes(capped) <= maxBytes) return capped;

  // Drop intermediate text parts oldest-first, preserving the last one.
  for (let i = 0; i < capped.length - 1 && jsonBytes(capped) > maxBytes; i++) {
    const p = capped[i];
    if (p.kind === "text" && p.text) {
      capped[i] = { ...p, text: "(intermediate text omitted — too large to store)" };
    }
  }

  // Last resort: hard-truncate the final text part to fit.
  const last = capped[capped.length - 1];
  const overshoot = jsonBytes(capped) - maxBytes;
  if (overshoot > 0 && last?.kind === "text") {
    capped[capped.length - 1] = {
      ...last,
      text: last.text.slice(0, Math.max(0, last.text.length - overshoot)),
    };
  }
  return capped;
}

/** Human-readable label for a tool part (used by the folded tool row). */
export function toolLabel(part: RenderToolPart): string {
  const input = (part.input ?? {}) as Record<string, unknown>;
  switch (part.name) {
    case "loadSkill":
      return input.name ? `Loaded skill ${input.name}` : "Loaded a skill";
    case "listTables":
      return "Listed tables";
    case "describeTable":
      return input.table ? `Described ${input.table}` : "Described a table";
    case "runSql":
      return part.status === "error" ? "Ran SQL (failed)" : "Ran SQL query";
    case "presentData":
      return input.title ? `Presented ${input.title}` : "Presented a view";
    case "askUser": {
      const questions = normalizeAskUserQuestions(part.input);
      const first = questions[0]?.question ?? "";
      if (!first) return "Asked a question";
      const label = first.length > 80 ? `${first.slice(0, 80)}…` : first;
      return questions.length > 1
        ? `Asked: ${label} (+${questions.length - 1} more)`
        : `Asked: ${label}`;
    }
    case "saveArtifact":
      return input.title ? `Saved ${input.title}` : "Saved an artifact";
    default:
      return part.name;
  }
}

/** One-line tool summaries for history compaction (name, SQL, row count). */
export function buildToolLines(parts: RenderPart[]): string[] {
  const lines: string[] = [];
  for (const part of parts) {
    if (part.kind !== "tool") continue;
    if (part.name === "runSql") {
      const input = (part.input ?? {}) as { sql?: string };
      const output = (part.output ?? {}) as { rowCount?: number };
      const sql = (input.sql ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      const rows =
        typeof output.rowCount === "number" ? ` (rows: ${output.rowCount})` : "";
      const failed = part.status === "error" ? " (failed)" : "";
      lines.push(`runSql: ${sql}${rows}${failed}`);
    } else if (part.name === "presentData") {
      lines.push(presentDataLine(part));
    } else if (part.name === "askUser") {
      lines.push(...askUserLines(part));
    } else {
      lines.push(toolLabel(part));
    }
  }
  return lines;
}

/** One line per question, e.g.
 * `askUser 1/2: "Which timeframe?" (single: Last 7 days | Last 30 days) → Last 30 days`
 * — the full questions and options stay in history so the next run sees a
 * coherent Q→A exchange with the user's answer turn. An answered part (TUI
 * inline answer, or the web answer mutation's patch) appends the picks. */
function askUserLines(part: RenderToolPart): string[] {
  const questions = normalizeAskUserQuestions(part.input);
  const answers = normalizeAskUserAnswers(part.output);
  if (questions.length === 0) return ["askUser: (no questions)"];
  return questions.map((q, i) => {
    const prefix =
      questions.length > 1 ? `askUser ${i + 1}/${questions.length}` : "askUser";
    const options = q.options.map((o) => o.label).join(" | ");
    let line = `${prefix}: "${q.question}" (${q.kind}: ${options})`;
    if (answers) {
      const a = answers[i];
      const picked = [
        a?.selected.length ? a.selected.join(", ") : "",
        a?.otherText ? `Other: ${a.otherText}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      line += ` → ${picked || "(no answer)"}`;
    }
    return line;
  });
}

/** `presentData: bar "Stores by city" (x: city, y: count, result: <id>)` —
 * one line of spec+resultId context so later turns can say "sort it
 * descending" or "show that as a line" without re-running SQL. */
function presentDataLine(part: RenderToolPart): string {
  const input = (part.input ?? {}) as { title?: string; type?: string };
  const output = (part.output ?? {}) as Partial<PresentDataOutput>;
  const title = input.title ? ` "${input.title}"` : "";
  if (output.ok !== true) {
    const error = output.ok === false ? output.error : part.errorText;
    return `presentData: ${input.type ?? "view"}${title} (failed${error ? `: ${error}` : ""})`;
  }
  const view = output.view!;
  const fields: string[] = [];
  if (view.type === "table" && view.columns?.length) {
    fields.push(`columns: ${view.columns.join(", ")}`);
  } else if (view.type === "line") {
    fields.push(`x: ${view.x.column}`, `y: ${view.y.map((a) => a.column).join(", ")}`);
  } else if (view.type === "bar" || view.type === "scatter") {
    fields.push(`x: ${view.x.column}`, `y: ${view.y.column}`);
  } else if (view.type === "stat") {
    fields.push(`value: ${view.value.column}`);
  }
  fields.push(`result: ${output.resultId}`);
  return `presentData: ${view.type}${title} (${fields.join(", ")})`;
}
