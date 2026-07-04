"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { PanelLeft, PanelRight, Search } from "lucide-react";
import { api, type Id } from "@/lib/convexApi";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { SearchModal } from "@/components/sidebar/SearchModal";
import { Conversation } from "@/components/chat/Conversation";
import { ArtifactPanel } from "@/components/artifacts/ArtifactPanel";

export function ChatApp({ threadId }: { threadId?: Id<"threads"> }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [artifactRunId, setArtifactRunId] = useState<Id<"runs"> | null>(null);

  const thread = useQuery(api.threads.get, threadId ? { threadId } : "skip");
  const latestRun = useQuery(
    api.runs.latestForThread,
    threadId ? { threadId } : "skip",
  );

  // Reset the artifact panel when switching threads.
  useEffect(() => setArtifactRunId(null), [threadId]);

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

  const navigate = (id: Id<"threads">) => {
    router.push(`/c/${id}`);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };
  const newChat = () => {
    router.push("/");
    if (window.innerWidth < 768) setSidebarOpen(false);
  };
  const openThreadArtifacts = () => {
    if (latestRun) setArtifactRunId(latestRun._id);
  };

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
              onOpenArtifacts={openThreadArtifacts}
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
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PanelLeft className="size-4" />
            </button>
          )}
          {!sidebarOpen && (
            <button
              onClick={() => setSearchOpen(true)}
              title="Search (⌘K)"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Search className="size-4" />
            </button>
          )}
          <div className="flex-1 truncate text-sm font-medium">
            {thread?.title ?? "New chat"}
          </div>
          <button
            onClick={() =>
              artifactRunId ? setArtifactRunId(null) : openThreadArtifacts()
            }
            title="Toggle artifact panel"
            className={cn(
              "rounded-md p-1.5 hover:bg-accent hover:text-foreground",
              artifactRunId ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <PanelRight className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <Conversation
            threadId={threadId}
            onThreadCreated={navigate}
            onOpenArtifacts={setArtifactRunId}
          />

          {artifactRunId && (
            <>
              <div className="hidden w-[420px] shrink-0 border-l border-border lg:block">
                <ArtifactPanel runId={artifactRunId} onClose={() => setArtifactRunId(null)} />
              </div>
              <div className="fixed inset-0 z-40 lg:hidden">
                <div
                  className="absolute inset-0 bg-black/40"
                  onClick={() => setArtifactRunId(null)}
                />
                <div className="absolute right-0 top-0 h-full w-[92%] max-w-md border-l border-border shadow-xl">
                  <ArtifactPanel runId={artifactRunId} onClose={() => setArtifactRunId(null)} />
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
