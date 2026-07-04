import { PersistentTextStreaming } from "@convex-dev/persistent-text-streaming";
import { components } from "../_generated/api";

/** Shared persistent-text-streaming client (created once). */
export const persistentTextStreaming = new PersistentTextStreaming(
  components.persistentTextStreaming,
);
