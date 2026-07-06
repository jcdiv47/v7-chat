/**
 * Clerk auth proxy (Next 16's middleware). Redirects signed-out visitors on
 * page routes to /sign-in. API routes pass through so the tRPC context can
 * return a proper UNAUTHORIZED instead of a redirect (the SSE subscription
 * reconnects with cookies and must not follow HTML redirects).
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
const isApiRoute = createRouteMatcher(["/api(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req) && !isApiRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next internals and static assets, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes so auth() resolves in route handlers.
    "/(api|trpc)(.*)",
  ],
};
