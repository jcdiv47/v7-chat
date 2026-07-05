/**
 * The single tRPC HTTP endpoint: queries/mutations via POST/GET, and the
 * runs.stream SSE subscription (httpSubscriptionLink) over GET on the same
 * route. Long-lived streaming responses are fine here — the app runs as one
 * long-lived Node service, not serverless.
 */
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/root";
import { createContext } from "@/server/trpc/trpc";

export const dynamic = "force-dynamic";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
    onError({ error, path }) {
      console.error(`[trpc] ${path ?? "<no-path>"}:`, error.message);
    },
  });

export { handler as GET, handler as POST };
