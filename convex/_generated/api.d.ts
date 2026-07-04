/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_demo from "../agent/demo.js";
import type * as agent_drive from "../agent/drive.js";
import type * as agent_loop from "../agent/loop.js";
import type * as agent_webDeps from "../agent/webDeps.js";
import type * as artifacts from "../artifacts.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_streaming from "../lib/streaming.js";
import type * as messages from "../messages.js";
import type * as node_postgres from "../node/postgres.js";
import type * as runs from "../runs.js";
import type * as stream from "../stream.js";
import type * as threads from "../threads.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/demo": typeof agent_demo;
  "agent/drive": typeof agent_drive;
  "agent/loop": typeof agent_loop;
  "agent/webDeps": typeof agent_webDeps;
  artifacts: typeof artifacts;
  chat: typeof chat;
  crons: typeof crons;
  events: typeof events;
  "lib/constants": typeof lib_constants;
  "lib/streaming": typeof lib_streaming;
  messages: typeof messages;
  "node/postgres": typeof node_postgres;
  runs: typeof runs;
  stream: typeof stream;
  threads: typeof threads;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  persistentTextStreaming: import("@convex-dev/persistent-text-streaming/_generated/component.js").ComponentApi<"persistentTextStreaming">;
};
