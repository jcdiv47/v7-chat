"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowDown, Copy, Pencil, RotateCcw, X } from "lucide-react";
import { api, type Id } from "@/lib/convexApi";
import { cn } from "@/lib/utils";
import type { RenderPart } from "@/lib/agent/stream-parts";
import { AssistantTurn } from "./AssistantTurn";
import { Composer, type ModelAlias } from "./Composer";
import { EmptyState } from "./EmptyState";
import { useRunStream } from "./useRunStream";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Conversation({
  threadId,
  onThreadCreated,
}: {
  threadId: Id<"threads"> | undefined;
  onThreadCreated: (id: Id<"threads">) => void;
}) {
  const messages = useQuery(api.messages.list, threadId ? { threadId } : "skip");
  const latestRun = useQuery(
    api.runs.latestForThread,
    threadId ? { threadId } : "skip",
  );
  const sendMessage = useMutation(api.chat.sendMessage);
  const retryLast = useMutation(api.chat.retryLast);
  const editAndRerun = useMutation(api.chat.editAndRerun);
  const requestStop = useMutation(api.runs.requestStop);

  const [modelAlias, setModelAlias] = useState<ModelAlias>("analyst");
  /** One message queued while a run is live, scoped to the thread it was queued
   * for so it never dispatches into a different conversation. */
  const [queued, setQueued] = useState<{
    threadId: Id<"threads">;
    text: string;
    failed?: boolean;
  } | null>(null);
  const now = useNow(2000);

  const running = latestRun?.status === "running";
  const stale =
    running &&
    latestRun?.heartbeatAt != null &&
    now - latestRun.heartbeatAt > latestRun.staleThresholdMs;
  const liveStreaming = Boolean(running && !stale);

  const activeStreamId = running ? latestRun?.streamId : undefined;
  const { reduced, streamStatus } = useRunStream(activeStreamId);

  // Auto-scroll handling.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const bodyLength = (messages?.length ?? 0) + reduced.parts.length;
  useEffect(() => {
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [bodyLength, reduced, atBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const startRun = async (text: string) => {
    const res = await sendMessage({
      threadId: threadId ?? undefined,
      text,
      modelAlias,
    });
    setAtBottom(true);
    if (!threadId) onThreadCreated(res.threadId);
  };

  const enqueue = (threadId: Id<"threads">, text: string) =>
    setQueued((q) => ({
      threadId,
      text:
        q && q.threadId === threadId && !q.failed
          ? `${q.text}\n\n${text}`
          : text,
    }));

  const handleSend = async (text: string) => {
    // The backend allows one live run per thread: queue instead of sending.
    if (threadId && liveStreaming) {
      enqueue(threadId, text);
      return;
    }
    try {
      await startRun(text);
    } catch (err) {
      // The run-liveness query can lag the server: a send that races a live
      // run gets rejected there, so queue it instead of surfacing an error.
      if (threadId && err instanceof Error && /already in progress/i.test(err.message)) {
        enqueue(threadId, text);
        return;
      }
      throw err;
    }
  };

  // Dispatch the queued message once its thread has no live run. A stale run
  // doesn't block: sendMessage reclaims it server-side.
  const dispatchingQueuedRef = useRef(false);
  useEffect(() => {
    if (!queued || queued.failed || queued.threadId !== threadId) return;
    if (liveStreaming || dispatchingQueuedRef.current) return;
    dispatchingQueuedRef.current = true;
    const q = queued;
    setQueued(null);
    startRun(q.text)
      .catch(() => setQueued({ ...q, failed: true }))
      .finally(() => {
        dispatchingQueuedRef.current = false;
      });
  });

  const handleRetry = async () => {
    if (!threadId) return;
    await retryLast({ threadId, modelAlias });
    setAtBottom(true);
  };

  const handleEdit = async (messageId: Id<"messages">, text: string) => {
    await editAndRerun({ messageId, text, modelAlias });
    setAtBottom(true);
  };

  const handleStop = () => {
    if (latestRun) requestStop({ runId: latestRun._id });
  };

  const isEmpty = threadId == null || (messages && messages.length === 0);

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto"
      >
        {isEmpty && !running ? (
          <EmptyState onPick={handleSend} />
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {messages?.map((m) =>
              m.role === "user" ? (
                <UserBubble
                  key={m._id}
                  text={m.text}
                  canEdit={!running}
                  onEdit={(text) => handleEdit(m._id, text)}
                />
              ) : (
                <AssistantMessage
                  key={m._id}
                  parts={(m.parts as RenderPart[] | undefined) ?? textToParts(m.text)}
                  durationMs={m.durationMs}
                  failed={m.status === "failed"}
                  text={m.text}
                />
              ),
            )}

            {running && (
              <div className="group py-3">
                <AssistantTurn
                  parts={reduced.parts}
                  streaming={liveStreaming && streamStatus !== "done"}
                  workStartedAt={latestRun?.startedAt}
                  error={
                    stale
                      ? "This run stopped unexpectedly (the server went away). You can retry."
                      : reduced.errorText
                  }
                />
                {stale && (
                  <button
                    onClick={handleRetry}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <RotateCcw className="size-3.5" /> Retry
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {!atBottom && (
        <button
          onClick={() => {
            setAtBottom(true);
            scrollRef.current?.scrollTo({
              top: scrollRef.current.scrollHeight,
              behavior: "smooth",
            });
          }}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card p-2 shadow-md hover:bg-accent"
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="size-4" />
        </button>
      )}

      {queued && queued.threadId === threadId && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
              queued.failed
                ? "border-destructive/50 text-destructive"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate" title={queued.text}>
              {queued.failed
                ? "Couldn't send — "
                : "Queued for after this run — "}
              <span className="text-foreground/80">{queued.text}</span>
            </span>
            {queued.failed && (
              <button
                onClick={() => setQueued({ ...queued, failed: false })}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Retry
              </button>
            )}
            <button
              onClick={() => setQueued(null)}
              title="Discard"
              aria-label="Discard queued message"
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      <Composer
        onSend={handleSend}
        onStop={handleStop}
        streaming={liveStreaming}
        stopping={Boolean(latestRun?.stopRequested) && liveStreaming}
        modelAlias={modelAlias}
        onModelAliasChange={setModelAlias}
        threadId={threadId}
      />
    </div>
  );
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* no clipboard */
    }
  };
  return { copied, copy };
}

function UserBubble({
  text,
  canEdit,
  onEdit,
}: {
  text: string;
  canEdit: boolean;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const { copied, copy } = useCopy(text);

  const submit = () => {
    if (!draft.trim()) return;
    setEditing(false);
    onEdit(draft);
  };

  if (editing) {
    return (
      <div className="mb-5 flex justify-end">
        <div className="w-full max-w-[85%] rounded-2xl border border-border bg-secondary px-3 py-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            autoFocus
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            className="w-full resize-none bg-transparent px-1 py-1 text-[15px] text-secondary-foreground outline-none"
          />
          <div className="flex items-center justify-end gap-1.5 pb-0.5">
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!draft.trim()}
              className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group mb-5 flex flex-col items-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-[15px] text-secondary-foreground">
        {text}
      </div>
      <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <ActionButton title={copied ? "Copied" : "Copy"} onClick={copy}>
          <Copy className="size-3.5" />
        </ActionButton>
        {canEdit && (
          <ActionButton
            title="Edit and rerun from here"
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
          >
            <Pencil className="size-3.5" />
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({
  parts,
  durationMs,
  failed,
  text,
}: {
  parts: RenderPart[];
  durationMs?: number;
  failed?: boolean;
  text: string;
}) {
  const { copied, copy } = useCopy(text);
  return (
    <div className="group mb-5">
      <AssistantTurn
        parts={parts}
        streaming={false}
        durationMs={durationMs}
        error={failed && !text ? "This run failed." : undefined}
      />
      <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <ActionButton title={copied ? "Copied" : "Copy"} onClick={copy}>
          <Copy className="size-3.5" />
        </ActionButton>
      </div>
    </div>
  );
}

function ActionButton({
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

function textToParts(text: string): RenderPart[] {
  return [{ kind: "text", id: "t", text }];
}
