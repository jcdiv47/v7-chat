"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowDown, Copy, Pencil, RotateCcw } from "lucide-react";
import { api, type Id } from "@/lib/convexApi";
import type { RenderPart } from "@/lib/agent/stream-parts";
import { AssistantTurn } from "./AssistantTurn";
import { Composer, type ModelAlias } from "./Composer";
import { EmptyState } from "./EmptyState";
import { useRunStream } from "./useRunStream";

/** Stream IDs this browser tab initiated — survives client-side navigation, so a
 * new chat's first run is driven after we route to /c/[threadId]. Cleared by a
 * full refresh, which is exactly when a tab should reattach undriven. */
const initiatedStreams = new Set<string>();

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
  const now = useNow(2000);

  const running = latestRun?.status === "running";
  const stale =
    running &&
    latestRun?.heartbeatAt != null &&
    now - latestRun.heartbeatAt > latestRun.staleThresholdMs;
  const liveStreaming = Boolean(running && !stale);

  const activeStreamId = running ? latestRun?.streamId : undefined;
  const driven = Boolean(
    activeStreamId && !stale && initiatedStreams.has(activeStreamId),
  );
  const { reduced, streamStatus } = useRunStream(activeStreamId, driven);

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

  const handleSend = async (text: string) => {
    const res = await sendMessage({
      threadId: threadId ?? undefined,
      text,
      modelAlias,
    });
    initiatedStreams.add(res.streamId);
    setAtBottom(true);
    if (!threadId) onThreadCreated(res.threadId);
  };

  const handleRetry = async () => {
    if (!threadId) return;
    const res = await retryLast({ threadId, modelAlias });
    initiatedStreams.add(res.streamId);
    setAtBottom(true);
  };

  const handleEdit = async (messageId: Id<"messages">, text: string) => {
    const res = await editAndRerun({ messageId, text, modelAlias });
    initiatedStreams.add(res.streamId);
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
        >
          <ArrowDown className="size-4" />
        </button>
      )}

      <Composer
        onSend={handleSend}
        onStop={handleStop}
        streaming={liveStreaming}
        stopping={Boolean(latestRun?.stopRequested) && liveStreaming}
        modelAlias={modelAlias}
        onModelAliasChange={setModelAlias}
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
