/**
 * The wire format for resumable streaming. The agent's AI SDK UI message stream
 * is encoded as JSONL (one JSON `UIMessageChunk` per line) and appended to the
 * `@convex-dev/persistent-text-streaming` stream. The initiating tab reads it
 * over HTTP; refreshed/second tabs read the persisted body reactively. Both
 * decode the same lines and fold them into the render view model here, so the
 * live → folded lifecycle is identical. See docs/specs/01 & 05.
 *
 * Import-safe on the client (type-only import from `ai`).
 */
import type { UIMessageChunk } from "ai";

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

/** Fold an ordered list of chunks into render parts, preserving interleaving. */
export function reduceChunks(chunks: UIMessageChunk[]): ReducedMessage {
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

  for (const chunk of chunks) {
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
  }

  return { parts, finished, finishReason, errorText, aborted };
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
    case "saveArtifact":
      return input.title ? `Saved ${input.title}` : "Saved an artifact";
    default:
      return part.name;
  }
}
