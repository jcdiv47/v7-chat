/** Max tool-loop steps for interactive chat (docs/specs/02 → Loop Control). */
export const MAX_STEPS = 12;

/** A running run whose heartbeat is older than this is considered dead. */
export const HEARTBEAT_STALE_MS = 120_000;

/**
 * SDK-level timeouts for the agent stream. `chunkMs` fails a run in-process
 * when the provider stops sending chunks (instead of waiting for the sweeper
 * to reclaim it); it is generous because reasoning models can go quiet between
 * chunks. `stepMs` bounds one LLM step, `totalMs` the whole run.
 */
export const RUN_TIMEOUTS = {
  totalMs: 600_000,
  stepMs: 300_000,
  chunkMs: 90_000,
} as const;

/** Default model alias for the interactive analysis loop. */
export const DEFAULT_MODEL_ALIAS = "analyst" as const;
