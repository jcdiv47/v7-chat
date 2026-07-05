import { router } from "./trpc";
import { artifactsRouter } from "./routers/artifacts";
import { chatRouter } from "./routers/chat";
import { eventsRouter } from "./routers/events";
import { messagesRouter } from "./routers/messages";
import { runsRouter } from "./routers/runs";
import { threadsRouter } from "./routers/threads";

export const appRouter = router({
  chat: chatRouter,
  threads: threadsRouter,
  messages: messagesRouter,
  runs: runsRouter,
  artifacts: artifactsRouter,
  events: eventsRouter,
});

export type AppRouter = typeof appRouter;
