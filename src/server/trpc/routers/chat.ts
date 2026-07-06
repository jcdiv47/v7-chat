/**
 * Send / edit-and-rerun / retry. Each mutation runs one transaction that locks
 * the thread row (serializing claims per thread), enforces one live run via
 * claimThreadForRun (reclaiming a stale run inline), stores the message
 * changes, and inserts the new `running` run; then it starts the in-process
 * worker after commit. Port of convex/chat.ts. See docs/specs/11.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, gte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  normalizeAskUserQuestions,
  type AskUserAnswer,
  type QuestionAnswer,
} from "../../../lib/agent/types";
import type { RenderToolPart } from "../../../lib/agent/stream-parts";
import { bundledSkillSource } from "../../../lib/skills/loader";
import { DEFAULT_MODEL_ALIAS } from "../../constants";
import { artifacts, messages, runs, threads } from "../../db/schema";
import {
  appendEvent,
  claimThreadForRun,
  deriveTitle,
  newId,
  publishRunEnd,
  type Dbx,
} from "../../runs-service";
import { isDraining, startRun } from "../../run-worker";
import { publicProcedure, router } from "../trpc";

const modelAliasSchema = z.enum(["fast", "analyst", "sql", "summarizer"]);

/** The one_live_run_per_thread partial unique index backstops claim races;
 * surface a violation with the same message the fresh-run rejection uses so
 * the client's queue-instead-of-error handling catches both. */
function rethrowLiveRunConflict(err: unknown): never {
  for (let e = err; e; e = (e as { cause?: unknown }).cause) {
    if (
      typeof e === "object" &&
      (e as { code?: string }).code === "23505" &&
      (e as { constraint?: string }).constraint === "one_live_run_per_thread"
    ) {
      throw new Error("A run is already in progress for this thread. Stop it first.");
    }
  }
  throw err;
}

function assertNotDraining(): void {
  if (isDraining()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The server is restarting; try again in a few seconds.",
    });
  }
}

/** Lock the thread row so concurrent sends into one thread serialize. */
async function lockThread(tx: Dbx, threadId: string, userId: string) {
  const [thread] = await tx
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
    .for("update");
  if (!thread) throw new Error("Thread not found.");
  return thread;
}

async function insertRun(
  tx: Dbx,
  values: {
    threadId: string;
    userId: string;
    modelAlias: string;
    userMessageId: string;
    retryAnchorAt?: Date;
  },
): Promise<string> {
  const runId = newId();
  const now = new Date();
  await tx.insert(runs).values({
    id: runId,
    threadId: values.threadId,
    userId: values.userId,
    status: "running",
    stopRequested: false,
    heartbeatAt: now,
    modelAlias: values.modelAlias,
    skillsVersion: bundledSkillSource.version,
    activeSkillNames: bundledSkillSource.list().map((s) => s.name),
    loadedSkillNames: [],
    userMessageId: values.userMessageId,
    retryAnchorAt: values.retryAnchorAt,
    startedAt: now,
  });
  await tx.update(threads).set({ updatedAt: now }).where(eq(threads.id, values.threadId));
  return runId;
}

export const chatRouter = router({
  /** Store the user message, create the run, and start the worker. Enforces
   * one live run per thread. */
  send: publicProcedure
    .input(
      z.object({
        threadId: z.uuid().optional(),
        text: z.string(),
        modelAlias: modelAliasSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertNotDraining();
      const trimmed = input.text.trim();
      if (!trimmed) throw new Error("Message is empty.");
      const alias = input.modelAlias ?? DEFAULT_MODEL_ALIAS;

      const result = await ctx.db
        .transaction(async (tx) => {
          const now = new Date();

          // Resolve or create the thread.
          let tid = input.threadId ?? null;
          if (tid) {
            await lockThread(tx, tid, ctx.userId);
          } else {
            tid = newId();
            await tx.insert(threads).values({
              id: tid,
              userId: ctx.userId,
              title: deriveTitle(trimmed),
              pinned: false,
              createdAt: now,
              updatedAt: now,
            });
          }

          const { reclaimedRunId } = await claimThreadForRun(tx, tid);

          const userMessageId = newId();
          await tx.insert(messages).values({
            id: userMessageId,
            threadId: tid,
            userId: ctx.userId,
            role: "user",
            text: trimmed,
            createdAt: now,
          });

          // Name a fresh thread after its first message.
          const [{ count }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(messages)
            .where(eq(messages.threadId, tid));
          if (count === 1) {
            await tx
              .update(threads)
              .set({ title: deriveTitle(trimmed) })
              .where(and(eq(threads.id, tid), eq(threads.title, "New chat")));
          }

          const runId = await insertRun(tx, {
            threadId: tid,
            userId: ctx.userId,
            modelAlias: alias,
            userMessageId,
          });
          await appendEvent(tx, {
            runId,
            threadId: tid,
            type: "run.started",
            metadata: { modelAlias: alias, userMessageId },
          });
          return { threadId: tid, runId, userMessageId, reclaimedRunId };
        })
        .catch(rethrowLiveRunConflict);

      if (result.reclaimedRunId) publishRunEnd(result.reclaimedRunId);
      startRun(result.runId);
      return {
        threadId: result.threadId,
        runId: result.runId,
        userMessageId: result.userMessageId,
      };
    }),

  /**
   * Answer a pending askUser clarification call (one answer per question, in
   * question order): patch the stored tool part with the answers (so the card
   * renders as answered forever), insert a user message carrying a readable
   * rendering of the Q→A pairs, and start the next run exactly like send.
   * See docs/specs/10.
   */
  answerQuestion: publicProcedure
    .input(
      z.object({
        messageId: z.uuid(),
        toolCallId: z.string(),
        answers: z
          .array(
            z.object({
              selected: z.array(z.string()),
              otherText: z.string().optional(),
            }),
          )
          .min(1)
          .max(3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertNotDraining();
      const answers: QuestionAnswer[] = input.answers.map((a) => ({
        selected: a.selected.map((s) => s.trim()).filter(Boolean),
        otherText: a.otherText?.trim() || undefined,
      }));
      if (answers.some((a) => a.selected.length === 0 && !a.otherText)) {
        throw new Error("Answer every question: pick an option or write an answer.");
      }

      const result = await ctx.db
        .transaction(async (tx) => {
          const message = await tx.query.messages.findFirst({
            where: and(eq(messages.id, input.messageId), eq(messages.userId, ctx.userId)),
          });
          if (!message || message.role !== "assistant") {
            throw new Error("Message not found.");
          }
          const threadId = message.threadId;
          await lockThread(tx, threadId, ctx.userId);

          // A stale run never blocks an answer; a fresh live run rejects here.
          const { reclaimedRunId, latestRun } = await claimThreadForRun(tx, threadId);

          // Only the thread's latest message can carry an answerable question.
          const [latestMessage] = await tx
            .select({ id: messages.id })
            .from(messages)
            .where(eq(messages.threadId, threadId))
            .orderBy(desc(messages.createdAt))
            .limit(1);
          if (latestMessage?.id !== message.id) {
            throw new Error("This question is no longer answerable.");
          }

          const parts = (message.parts ?? []) as RenderToolPart[];
          const partIndex = parts.findIndex(
            (p) =>
              p?.kind === "tool" &&
              p.name === "askUser" &&
              p.toolCallId === input.toolCallId,
          );
          if (partIndex === -1) throw new Error("Question not found.");
          const part = parts[partIndex];
          if (part.status !== "running") {
            throw new Error("This question was already answered.");
          }

          const questions = normalizeAskUserQuestions(part.input);
          if (questions.length === 0 || answers.length !== questions.length) {
            throw new Error("Answers don't match the questions asked.");
          }
          questions.forEach((q, i) => {
            const labels = new Set(q.options.map((o) => o.label));
            if (answers[i].selected.some((s) => !labels.has(s))) {
              throw new Error(
                "Selected option is not one of the question's choices.",
              );
            }
            if (q.kind === "single" && answers[i].selected.length > 1) {
              throw new Error("This question takes a single choice.");
            }
          });

          // Patch the part in place: output + status "done", or the work
          // block's tool row pulses as running forever.
          const answer: AskUserAnswer = { answered: true, answers };
          const patched = [...parts];
          patched[partIndex] = { ...part, status: "done", output: answer };
          await tx
            .update(messages)
            .set({ parts: patched })
            .where(eq(messages.id, message.id));

          // Readable rendering of the answers; history compaction feeds this
          // to the model unchanged. Multi-question answers repeat the question
          // so each pair reads unambiguously.
          const renderAnswer = (a: QuestionAnswer) => {
            const pieces: string[] = [];
            if (a.selected.length === 1) pieces.push(a.selected[0]);
            else if (a.selected.length > 1)
              pieces.push(`Selected: ${a.selected.join(", ")}`);
            if (a.otherText) pieces.push(`Other: ${a.otherText}`);
            return pieces.join("; ");
          };
          const text =
            questions.length === 1
              ? renderAnswer(answers[0])
              : questions
                  .map((q, i) => `${q.question} — ${renderAnswer(answers[i])}`)
                  .join("\n");

          const now = new Date();
          const userMessageId = newId();
          await tx.insert(messages).values({
            id: userMessageId,
            threadId,
            userId: ctx.userId,
            role: "user",
            text,
            createdAt: now,
          });

          const alias =
            latestRun?.modelAlias ?? DEFAULT_MODEL_ALIAS;
          const runId = await insertRun(tx, {
            threadId,
            userId: ctx.userId,
            modelAlias: alias,
            userMessageId,
          });
          await appendEvent(tx, {
            runId,
            threadId,
            type: "run.started",
            metadata: {
              modelAlias: alias,
              answeredQuestion: true,
              toolCallId: input.toolCallId,
              userMessageId,
            },
          });
          return { threadId, runId, userMessageId, reclaimedRunId };
        })
        .catch(rethrowLiveRunConflict);

      if (result.reclaimedRunId) publishRunEnd(result.reclaimedRunId);
      startRun(result.runId);
      return {
        threadId: result.threadId,
        runId: result.runId,
        userMessageId: result.userMessageId,
      };
    }),

  /**
   * Edit a user message and rerun from that point: every message after the
   * edited one is discarded (along with artifacts produced by those discarded
   * turns), then a new run regenerates the answer. History fed to the model is
   * anchored at the edited turn via retryAnchorAt, same as retry.
   */
  editAndRerun: publicProcedure
    .input(
      z.object({
        messageId: z.uuid(),
        text: z.string(),
        modelAlias: modelAliasSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertNotDraining();
      const trimmed = input.text.trim();
      if (!trimmed) throw new Error("Message is empty.");

      const result = await ctx.db
        .transaction(async (tx) => {
          const message = await tx.query.messages.findFirst({
            where: and(eq(messages.id, input.messageId), eq(messages.userId, ctx.userId)),
          });
          if (!message || message.role !== "user") {
            throw new Error("Message not found.");
          }
          const threadId = message.threadId;
          await lockThread(tx, threadId, ctx.userId);

          const { reclaimedRunId, latestRun } = await claimThreadForRun(tx, threadId);

          // Discard everything after the edited message. gte + skip-self also
          // catches a follower stamped with the same createdAt, which
          // retryAnchorAt's <= comparison would otherwise leak into history.
          await tx
            .delete(messages)
            .where(
              and(
                eq(messages.threadId, threadId),
                gte(messages.createdAt, message.createdAt),
                ne(messages.id, message.id),
              ),
            );

          // Artifacts from discarded turns were all created after the edited
          // message (one live run per thread means earlier turns' runs finished
          // before it). The discarded turns' runs/run_events rows are kept for
          // run-level observability.
          await tx
            .delete(artifacts)
            .where(
              and(
                eq(artifacts.threadId, threadId),
                gt(artifacts.createdAt, message.createdAt),
              ),
            );

          await tx
            .update(messages)
            .set({ text: trimmed })
            .where(eq(messages.id, message.id));

          // Keep the thread title in sync when its first message is edited.
          const [first] = await tx
            .select({ id: messages.id })
            .from(messages)
            .where(eq(messages.threadId, threadId))
            .orderBy(asc(messages.createdAt))
            .limit(1);
          if (first?.id === message.id) {
            await tx
              .update(threads)
              .set({ title: deriveTitle(trimmed) })
              .where(eq(threads.id, threadId));
          }

          const alias =
            input.modelAlias ?? latestRun?.modelAlias ?? DEFAULT_MODEL_ALIAS;
          const runId = await insertRun(tx, {
            threadId,
            userId: ctx.userId,
            modelAlias: alias,
            userMessageId: message.id,
            retryAnchorAt: message.createdAt,
          });
          await appendEvent(tx, {
            runId,
            threadId,
            type: "run.started",
            metadata: { modelAlias: alias, edit: true, userMessageId: message.id },
          });
          return { threadId, runId, reclaimedRunId };
        })
        .catch(rethrowLiveRunConflict);

      if (result.reclaimedRunId) publishRunEnd(result.reclaimedRunId);
      startRun(result.runId);
      return { threadId: result.threadId, runId: result.runId };
    }),

  /**
   * Retry: start a new run that regenerates the answer to the most recent user
   * message. The previous assistant response stays in history; the new run's
   * model context is anchored at that user turn so it does not see the old
   * answer.
   */
  retry: publicProcedure
    .input(
      z.object({
        threadId: z.uuid(),
        modelAlias: modelAliasSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertNotDraining();

      const result = await ctx.db
        .transaction(async (tx) => {
          await lockThread(tx, input.threadId, ctx.userId);
          const { reclaimedRunId, latestRun } = await claimThreadForRun(
            tx,
            input.threadId,
          );

          const [lastUser] = await tx
            .select()
            .from(messages)
            .where(
              and(eq(messages.threadId, input.threadId), eq(messages.role, "user")),
            )
            .orderBy(desc(messages.createdAt))
            .limit(1);
          if (!lastUser) throw new Error("Nothing to retry.");

          const alias =
            input.modelAlias ?? latestRun?.modelAlias ?? DEFAULT_MODEL_ALIAS;
          const runId = await insertRun(tx, {
            threadId: input.threadId,
            userId: ctx.userId,
            modelAlias: alias,
            userMessageId: lastUser.id,
            retryAnchorAt: lastUser.createdAt,
          });
          await appendEvent(tx, {
            runId,
            threadId: input.threadId,
            type: "run.started",
            metadata: { modelAlias: alias, retry: true },
          });
          return { threadId: input.threadId, runId, reclaimedRunId };
        })
        .catch(rethrowLiveRunConflict);

      if (result.reclaimedRunId) publishRunEnd(result.reclaimedRunId);
      startRun(result.runId);
      return { threadId: result.threadId, runId: result.runId };
    }),
});
