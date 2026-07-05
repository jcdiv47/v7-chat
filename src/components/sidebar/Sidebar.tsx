"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  BarChart3,
  FolderClosed,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api, type Doc, type Id } from "@/lib/convexApi";
import { cn, recencyBucket, recencyLabels } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/ThemeToggle";

type Thread = Pick<Doc<"threads">, "_id" | "title" | "pinned" | "updatedAt" | "createdAt">;

export function Sidebar({
  activeThreadId,
  onNavigate,
  onNewChat,
  onOpenSearch,
  onOpenArtifacts,
  onCollapse,
}: {
  activeThreadId: Id<"threads"> | undefined;
  onNavigate: (id: Id<"threads">) => void;
  onNewChat: () => void;
  onOpenSearch: () => void;
  onOpenArtifacts: () => void;
  onCollapse: () => void;
}) {
  const threads = (useQuery(api.threads.list) ?? []) as Thread[];
  const pinned = threads.filter((t) => t.pinned);
  const recents = threads.filter((t) => !t.pinned);

  const buckets: Record<string, Thread[]> = {};
  for (const t of recents) {
    const b = recencyBucket(t.updatedAt);
    (buckets[b] ??= []).push(t);
  }
  const bucketOrder: Array<keyof typeof recencyLabels> = [
    "today",
    "pastWeek",
    "pastMonth",
    "older",
  ];

  return (
    <div className="flex h-full w-[260px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="flex items-center gap-1 px-3 py-3">
        <div className="flex flex-1 items-center gap-2 px-1">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="size-3.5" />
          </div>
          <span className="text-sm font-semibold">v7 Analyst</span>
        </div>
        <IconBtn title="Search (⌘K)" onClick={onOpenSearch}>
          <Search className="size-4" />
        </IconBtn>
        <IconBtn title="Collapse sidebar" onClick={onCollapse}>
          <PanelLeftClose className="size-4" />
        </IconBtn>
      </div>

      {/* New chat */}
      <div className="px-3">
        <button
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
        >
          <Plus className="size-4" /> New chat
        </button>
      </div>

      {/* Primary nav */}
      <nav className="mt-3 space-y-0.5 px-3">
        <NavItem icon={<MessageSquare className="size-4" />} label="Chats" active />
        <NavItem icon={<FolderClosed className="size-4" />} label="Projects" />
        <NavItem
          icon={<BarChart3 className="size-4" />}
          label="Artifacts"
          onClick={onOpenArtifacts}
        />
        <NavItem icon={<Settings2 className="size-4" />} label="Customize" />
      </nav>

      {/* Sessions */}
      <div className="mt-3 flex-1 overflow-y-auto px-3 pb-3">
        {pinned.length > 0 && (
          <Section label="Pinned">
            {pinned.map((t) => (
              <ThreadRow
                key={t._id}
                thread={t}
                active={t._id === activeThreadId}
                onNavigate={onNavigate}
                onActiveDeleted={onNewChat}
              />
            ))}
          </Section>
        )}
        {bucketOrder.map((b) =>
          buckets[b]?.length ? (
            <Section key={b} label={recencyLabels[b]}>
              {buckets[b].map((t) => (
                <ThreadRow
                  key={t._id}
                  thread={t}
                  active={t._id === activeThreadId}
                  onNavigate={onNavigate}
                  onActiveDeleted={onNewChat}
                />
              ))}
            </Section>
          ) : null,
        )}
        {threads.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No conversations yet.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-sidebar-border px-3 py-2.5">
        <div className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium">
          A
        </div>
        <div className="flex-1 leading-tight">
          <div className="text-xs font-medium">Anonymous</div>
          <div className="text-[11px] text-muted-foreground">Local · V1</div>
        </div>
        <ThemeToggle />
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  onNavigate,
  onActiveDeleted,
}: {
  thread: Thread;
  active: boolean;
  onNavigate: (id: Id<"threads">) => void;
  onActiveDeleted: () => void;
}) {
  const setPinned = useMutation(api.threads.setPinned);
  const rename = useMutation(api.threads.rename);
  const remove = useMutation(api.threads.remove);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() && draft !== thread.title)
            rename({ threadId: thread._id, title: draft });
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(thread.title);
            setEditing(false);
          }
        }}
        className="w-full rounded-md border border-ring/50 bg-background px-2 py-1.5 text-sm outline-none"
      />
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center rounded-md pr-1 transition-colors",
        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      <button
        onClick={() => onNavigate(thread._id)}
        className="flex-1 truncate px-2 py-1.5 text-left text-sm"
        title={thread.title}
      >
        {thread.title}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Thread options"
            className={cn(
              "rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setPinned({ threadId: thread._id, pinned: !thread.pinned })}>
            {thread.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {thread.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setDraft(thread.title);
              setEditing(true);
            }}
          >
            <Pencil className="size-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onClick={() => {
              if (!window.confirm(`Delete "${thread.title}"? This cannot be undone.`)) {
                return;
              }
              void remove({ threadId: thread._id });
              // Leave the deleted thread's route so the app doesn't strand on
              // a dead thread id (empty state over a "Thread not found" send).
              if (active) onActiveDeleted();
            }}
          >
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}
