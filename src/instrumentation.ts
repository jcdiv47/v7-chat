/** Next.js instrumentation hook: boots the in-process worker environment
 * (migrations, sweeper, drain handlers) alongside the web server — the
 * service topology described in docs/specs/01-system-architecture.md without
 * owning the HTTP server. */
export async function register(): Promise<void> {
  // Deliberate exception to the environment-module boundary: NEXT_RUNTIME is
  // supplied by Next.js to select its platform runtime, not app configuration.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootServer } = await import("./server/boot");
  await bootServer();
}
