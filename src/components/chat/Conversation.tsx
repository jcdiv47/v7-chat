"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowDown, Copy, RotateCcw, PanelRightOpen } from "lucide-react";
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
  onOpenArtifacts,
}: {
  threadId: Id<"threads"> | undefined;
  onThreadCreated: (id: Id<"threads">) => void;
  onOpenArtifacts: (runId: Id<"runs">) => void;
}) {
  const messages = useQuery(api.messages.list, threadId ? { threadId } : "skip");
  const latestRun = useQuery(
    api.runs.latestForThread,
    threadId ? { threadId } : "skip",
  );
  const sendMessage = useMutation(api.chat.sendMessage);
  const retryLast = useMutation(api.chat.retryLast);
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

  const handleStop = () => {
    if (latestRun) requestStop({ runId: latestRun._id });
  };

  const isEmpty = threadId == null || (messages && messages.length === 0);
  const lastAssistantId = useMemo(() => {
    if (!messages) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i]._id;
    }
    return null;
  }, [messages]);

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
                <UserBubble key={m._id} text={m.text} />
              ) : (
                <AssistantMessage
                  key={m._id}
                  parts={(m.parts as RenderPart[] | undefined) ?? textToParts(m.text)}
                  durationMs={m.durationMs}
                  failed={m.status === "failed"}
                  text={m.text}
                  isLast={m._id === lastAssistantId}
                  canRetry={!running}
                  onRetry={handleRetry}
                  onOpenArtifacts={
                    m.runId ? () => onOpenArtifacts(m.runId as Id<"runs">) : undefined
                  }
                />
              ),
            )}

            {running && (
              <div className="group py-3">
                <AssistantTurn
                  parts={reduced.parts}
                  streaming={liveStreaming && streamStatus !== "done"}
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

function UserBubble({ text }: { text: string }) {
  return (
    <div className="mb-5 flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-[15px] text-secondary-foreground">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  parts,
  durationMs,
  failed,
  text,
  isLast,
  canRetry,
  onRetry,
  onOpenArtifacts,
}: {
  parts: RenderPart[];
  durationMs?: number;
  failed?: boolean;
  text: string;
  isLast: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onOpenArtifacts?: () => void;
}) {
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
        {isLast && canRetry && (
          <ActionButton title="Retry" onClick={onRetry}>
            <RotateCcw className="size-3.5" />
          </ActionButton>
        )}
        {onOpenArtifacts && (
          <ActionButton title="Open artifacts" onClick={onOpenArtifacts}>
            <PanelRightOpen className="size-3.5" />
          </ActionButton>
        )}
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
