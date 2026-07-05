/** Single anonymous user placeholder for V1 (real auth arrives in V2, when the
 * tRPC context resolves a session instead of this constant). */
export const ANON_USER_ID = "anon";

/** Max tool-loop steps for interactive chat (docs/specs/02 → Loop Control). */
export const MAX_STEPS = 12;

/** A running run whose heartbeat is older than this is considered dead. */
export const HEARTBEAT_STALE_MS = 120_000;

/** Default model alias for the interactive analysis loop. */
export const DEFAULT_MODEL_ALIAS = "analyst" as const;
