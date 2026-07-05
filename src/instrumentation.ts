/** Next.js instrumentation hook: boots the in-process worker environment
 * (migrations, sweeper, drain handlers) alongside the web server — the
 * "custom entry" of docs/specs/11 without owning the HTTP server. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootServer } = await import("./server/boot");
  await bootServer();
}
