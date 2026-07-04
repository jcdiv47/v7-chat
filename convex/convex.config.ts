import { defineApp } from "convex/server";
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/convex.config";

const app = defineApp();
// Live streaming source of truth: persists JSONL-encoded UI message parts so
// in-flight runs survive browser refresh. See docs/specs/01 → Resumable Streaming.
app.use(persistentTextStreaming);

export default app;
