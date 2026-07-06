/** Client-side tRPC hooks + inferred API types. Type-only import of the server
 * router, so no server code lands in the client bundle. */
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";

export const trpc = createTRPCReact<AppRouter>();

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type ThreadSummary = RouterOutputs["threads"]["list"][number];
export type MessageItem = RouterOutputs["messages"]["list"][number];
export type RunSummary = NonNullable<RouterOutputs["runs"]["latestForThread"]>;
export type ArtifactItem = RouterOutputs["artifacts"]["listForRun"][number];
