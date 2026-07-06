"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, Copy, Pencil, RotateCcw, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
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
  threadId: string | undefined;
  onThreadCreated: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const { data: messages } = trpc.messages.list.useQuery(
    { threadId: threadId ?? "" },
    { enabled: Boolean(threadId) },
  );
  const { data: latestRun } = trpc.runs.latestForThread.useQuery(
    { threadId: threadId ?? "" },
    {
      enabled: Boolean(threadId),
      // Poll while a run is live: covers heartbeat display, stop/reclaim by
      // the server, and acts as the backstop for missed invalidations.
      refetchInterval: (query) =>
        query.state.data?.status === "running" ? 2000 : false,
    },
  );
  const sendMessage = trpc.chat.send.useMutation();
  const retryLast = trpc.chat.retry.useMutation();
  const editAndRerun = trpc.chat.editAndRerun.useMutation();
  const answerQuestion = trpc.chat.answerQuestion.useMutation();
  const requestStop = trpc.runs.stop.useMutation();

  /** Refresh everything a finished or newly created run can have changed. */
  const refreshThread = () => {
    void utils.runs.latestForThread.invalidate();
    void utils.messages.list.invalidate();
    void utils.threads.list.invalidate();
  };

  const [modelAlias, setModelAlias] = useState<ModelAlias>("analyst");
  /** One message queued while a run is live, scoped to the thread it was queued
   * for so it never dispatches into a different conversation. */
  const [queued, setQueued] = useState<{
    threadId: string;
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

  const activeRunId = running ? latestRun?.id : undefined;
  const { reduced, streamStatus } = useRunStream(activeRunId);

  // The stream folding a terminal chunk is the low-latency completion signal,
  // but it can race ahead of finishRun() storing the assistant message, and
  // failure/cancel paths may never emit a terminal chunk at all.
  useEffect(() => {
    if (reduced.finished) refreshThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshThread is stable in practice
  }, [reduced.finished]);

  // Backstop: refresh when the run leaves "running". latestForThread only
  // reports a terminal status after the finishRun transaction that stored the
  // assistant message committed, so this refetch can't miss it — it covers
  // the finished-edge race above, terminal-chunk-less failures, and reclaims.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) refreshThread();
    wasRunning.current = running;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshThread is stable in practice
  }, [running]);

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
    const res = await sendMessage.mutateAsync({
      threadId: threadId ?? undefined,
      text,
      modelAlias,
    });
    setAtBottom(true);
    refreshThread();
    if (!threadId) onThreadCreated(res.threadId);
  };

  const enqueue = (threadId: string, text: string) =>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startRun is recreated every render
  }, [queued, threadId, liveStreaming]);

  // Retry/edit deliberately omit modelAlias so the backend falls back to the
  // model the original turn used, instead of the composer's (reset) selection.
  const handleRetry = async () => {
    if (!threadId) return;
    await retryLast.mutateAsync({ threadId });
    setAtBottom(true);
    refreshThread();
  };

  const handleEdit = async (messageId: string, text: string) => {
    await editAndRerun.mutateAsync({ messageId, text });
    setAtBottom(true);
    refreshThread();
  };

  const handleAnswerQuestion = async (
    messageId: string,
    toolCallId: string,
    selected: string[],
    otherText?: string,
  ) => {
    await answerQuestion.mutateAsync({ messageId, toolCallId, selected, otherText });
    setAtBottom(true);
    refreshThread();
  };

  const handleStop = () => {
    if (latestRun) {
      requestStop.mutate(
        { runId: latestRun.id },
        { onSuccess: () => void utils.runs.latestForThread.invalidate() },
      );
    }
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
          <EmptyState
            onPick={(q) => {
              // Surface a rejected send (e.g. the thread was just deleted)
              // through the queued-message banner instead of an unhandled
              // rejection that shows the user nothing.
              handleSend(q).catch(() => {
                if (threadId) setQueued({ threadId, text: q, failed: true });
              });
            }}
          />
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {messages?.map((m) =>
              m.role === "user" ? (
                <UserBubble
                  key={m.id}
                  text={m.text}
                  canEdit={!running}
                  onEdit={(text) => handleEdit(m.id, text)}
                />
              ) : // While latestRun still reads "running", the just-stored
              // assistant message for that run may already be in messages
              // (queries refetch independently) — the live stream block below
              // renders it, so skip the stored copy to avoid a duplicate.
              running && m.runId === latestRun?.id ? null : (
                <AssistantMessage
                  key={m.id}
                  parts={(m.parts as RenderPart[] | undefined) ?? textToParts(m.text)}
                  durationMs={m.durationMs ?? undefined}
                  failed={m.status === "failed"}
                  text={m.text}
                  canAnswerQuestion={
                    !running && m.id === messages[messages.length - 1]?.id
                  }
                  onAnswerQuestion={(toolCallId, selected, otherText) =>
                    handleAnswerQuestion(m.id, toolCallId, selected, otherText)
                  }
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
  canAnswerQuestion,
  onAnswerQuestion,
}: {
  parts: RenderPart[];
  durationMs?: number;
  failed?: boolean;
  text: string;
  canAnswerQuestion?: boolean;
  onAnswerQuestion?: (
    toolCallId: string,
    selected: string[],
    otherText?: string,
  ) => Promise<void>;
}) {
  const { copied, copy } = useCopy(text);
  return (
    <div className="group mb-5">
      <AssistantTurn
        parts={parts}
        streaming={false}
        durationMs={durationMs}
        error={failed && !text ? "This run failed." : undefined}
        canAnswerQuestion={canAnswerQuestion}
        onAnswerQuestion={onAnswerQuestion}
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
