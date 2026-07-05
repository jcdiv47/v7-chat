/**
 * History compaction. Messages are stored with full parts fidelity, but the
 * model context for a new turn is compacted: prior turns become user text,
 * assistant text, and one-line tool summaries (reasoning and raw tool outputs
 * are dropped), capped at the last 100 messages / ~20k tokens. See
 * docs/specs/02-agent-runtime.md → Message Storage And History.
 */
import type { ModelMessage } from "ai";

export type CompactTurn = {
  role: "user" | "assistant";
  text: string;
  /** One-line tool summaries for a prior assistant turn (name, SQL, row count). */
  toolLines?: string[];
};

const MAX_MESSAGES = 100;
/** ~20k tokens estimated at ~4 chars/token. */
const MAX_CHARS = 80_000;

function turnSize(turn: CompactTurn): number {
  return turn.text.length + (turn.toolLines?.join("\n").length ?? 0);
}

function toModelMessage(turn: CompactTurn): ModelMessage {
  if (turn.role === "user") {
    return { role: "user", content: turn.text || "(empty message)" };
  }
  const segments = [turn.text.trim()];
  if (turn.toolLines && turn.toolLines.length > 0) {
    segments.push(`\n[tools used]\n${turn.toolLines.join("\n")}`);
  }
  const content = segments.filter(Boolean).join("\n").trim();
  return { role: "assistant", content: content || "(no textual response)" };
}

/**
 * Build the model messages for a turn from chronological compacted turns
 * (including the new user message as the final turn). Caps by message count and
 * character budget, keeping the most recent turns.
 */
export function buildModelMessages(turns: CompactTurn[]): ModelMessage[] {
  const recent = turns.slice(-MAX_MESSAGES);

  const budgeted: CompactTurn[] = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i];
    const size = turnSize(turn);
    if (budgeted.length > 0 && total + size > MAX_CHARS) break;
    budgeted.unshift(turn);
    total += size;
  }

  // Truncation can leave the history starting with an assistant turn, which
  // some providers reject — the conversation must open with a user message.
  while (budgeted.length > 0 && budgeted[0].role === "assistant") budgeted.shift();

  return budgeted.map(toModelMessage);
}
