"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PanelLeft, PanelRight, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SearchModal } from "@/components/sidebar/SearchModal";
import { Conversation } from "@/components/chat/Conversation";
import { ArtifactPanel } from "@/components/artifacts/ArtifactPanel";

export function ChatApp({ threadId }: { threadId?: string }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  // The artifact panel is run-scoped. Selection is one of:
  //   null                          → panel closed
  //   { kind: "latest" }            → the thread's latest run (default/global)
  //   { kind: "run"; runId }        → an explicit historical assistant response
  // A discriminated union (not "latest" | string, which collapses to string)
  // keeps the sentinel distinct from a runId at the type level. "latest"
  // resolves to runs.latestForThread at render time so the default panel
  // tracks the newest run.
  const [artifactSel, setArtifactSel] = useState<
    null | { kind: "latest" } | { kind: "run"; runId: string }
  >(null);

  const { data: thread } = trpc.threads.get.useQuery(
    { threadId: threadId ?? "" },
    { enabled: Boolean(threadId) },
  );
  const { data: latestRun } = trpc.runs.latestForThread.useQuery(
    { threadId: threadId ?? "" },
    { enabled: Boolean(threadId) },
  );

  const selectedRunId =
    artifactSel == null
      ? null
      : artifactSel.kind === "latest"
        ? (latestRun?.id ?? null)
        : artifactSel.runId;

  // Reset the artifact panel when switching threads.
  useEffect(() => setArtifactSel(null), [threadId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = (id: string) => {
    router.push(`/c/${id}`);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };
  const newChat = () => {
    router.push("/");
    if (window.innerWidth < 768) setSidebarOpen(false);
  };
  // Global/sidebar/top-bar entry point: always target the latest run. If a
  // historical run is currently open, this switches the panel back to latest.
  const openLatestArtifacts = () => setArtifactSel({ kind: "latest" });
  const closeArtifacts = () => setArtifactSel(null);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <div className="z-40 shrink-0">
          <div
            className="fixed inset-0 bg-black/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed left-0 top-0 z-40 h-dvh md:static md:h-full">
            <Sidebar
              activeThreadId={threadId}
              onNavigate={navigate}
              onNewChat={newChat}
              onOpenSearch={() => setSearchOpen(true)}
              onOpenArtifacts={openLatestArtifacts}
              onCollapse={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              title="Open sidebar"
              aria-label="Open sidebar"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PanelLeft className="size-4" />
            </button>
          )}
          {!sidebarOpen && (
            <button
              onClick={() => setSearchOpen(true)}
              title="Search (⌘K)"
              aria-label="Search conversations"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Search className="size-4" />
            </button>
          )}
          <div className="flex-1 truncate text-sm font-medium">
            {thread?.title ?? "New chat"}
          </div>
          {latestRun && (
            <button
              onClick={() => (selectedRunId ? closeArtifacts() : openLatestArtifacts())}
              title="Toggle artifact panel"
              aria-label="Toggle artifact panel"
              className={cn(
                "rounded-md p-1.5 hover:bg-accent hover:text-foreground",
                selectedRunId ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <PanelRight className="size-4" />
            </button>
          )}
        </header>

        <div className="flex min-h-0 flex-1">
          <Conversation
            threadId={threadId}
            onThreadCreated={navigate}
            onOpenArtifacts={(runId) => setArtifactSel({ kind: "run", runId })}
            onCloseArtifacts={closeArtifacts}
            selectedRunId={selectedRunId}
          />

          {selectedRunId && (
            <>
              <div className="hidden w-[420px] shrink-0 border-l border-border lg:block">
                <ArtifactPanel runId={selectedRunId} onClose={closeArtifacts} />
              </div>
              <div className="fixed inset-0 z-40 lg:hidden">
                <div className="absolute inset-0 bg-black/40" onClick={closeArtifacts} />
                <div className="absolute right-0 top-0 h-full w-[92%] max-w-md border-l border-border shadow-xl">
                  <ArtifactPanel runId={selectedRunId} onClose={closeArtifacts} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} onSelect={navigate} />
    </div>
  );
}
