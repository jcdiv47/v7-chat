import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { runChatStream } from "./agent/loop";

const http = httpRouter();

/**
 * Chat stream endpoint. The `useStream` hook POSTs `{ streamId }` here to drive
 * a run. The run executes in this HTTP action (V8), detached from the client
 * connection: a disconnect/refresh must not abort it. See docs/specs/01.
 */
const chat = httpAction(async (ctx, request) => {
  let streamId: string | undefined;
  try {
    // Clone so the persistent-streaming component still sees the original body.
    const body = (await request.clone().json()) as { streamId?: string };
    streamId = body.streamId;
  } catch {
    return new Response("Expected a JSON body with a streamId.", { status: 400 });
  }
  if (!streamId) {
    return new Response("Missing streamId.", { status: 400 });
  }
  return await runChatStream(ctx, request, streamId);
});

http.route({ path: "/chat", method: "POST", handler: chat });

// CORS preflight for the Next.js origin (endpoint is on *.convex.site).
http.route({
  path: "/chat",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        request.headers.get("Access-Control-Request-Headers") ?? "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    return new Response(null, { status: 204, headers });
  }),
});

export default http;
