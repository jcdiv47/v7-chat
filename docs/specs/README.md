# Agentic Business Data Analysis App Specs

Status: Draft V1  
Last updated: 2026-07-06
Owner: scishang/v7

This directory captures the product and technical specs for the V1 agentic business data analysis app.

## Decisions Already Made

- The backend is a single long-lived Next.js service backed by Postgres
  (Drizzle), with a tRPC API and an in-process run worker.
- Streaming survives browser refresh and disconnects: the agent loop runs in an in-process worker; JSONL-encoded UI message parts are published on an in-memory RunBus and persisted to `run_chunks`, and clients render them via a cursor-based tRPC SSE subscription.
- Clerk authentication is active; app data is scoped by `user_id`, and the text
  ownership column leaves room for BetterAuth if the auth provider changes.
- Agent skills are bundled into the server at build time; the TUI reads the same skill files from disk.
- Messages are stored as AI SDK UI messages with full parts fidelity; prior-turn history is compacted before being sent to the model.
- Search stays on standard Railway Postgres in V1. The app maintains a separate
  title-search index table with app-side English tokenization and Chinese bigram
  tokenization; message-body search is deferred.
- Business analysis queries run only against a separate intermediate Postgres database.
- Raw business Postgres is outside the agent runtime path.
- V1 database scope is small: `cities`, `malls`, and `stores`.
- AI SDK V7 `ToolLoopAgent` is the primary interactive agent runtime.
- AI SDK V7 `WorkflowAgent` is reserved for durable or long-running workflows.
- OpenRouter is the first-class model provider for V1.
- Provider-native skill upload is not required for V1; use provider-neutral local agent skills.
- Langfuse is deferred to V2. V1 logs the run metadata needed to migrate later
  (thread/run ids, model ids, tool activity, and SQL statements), and the
  Langfuse-readiness work should widen usage persistence to keep full provider
  usage payloads and OpenRouter raw cost when present.
- Full semantic layer and strict SQL governance are V2 concerns.
- Fuzzy search, PGroonga-backed multilingual search, and message-body search
  remain future directions.

## Spec Index

- [00 Product Scope](./00-product-scope.md): product goals, non-goals, user workflows, assumptions.
- [01 System Architecture](./01-system-architecture.md): services, runtime boundaries, app database schema, tRPC API surface, data flow, deployment shape.
- [02 Agent Runtime](./02-agent-runtime.md): ToolLoopAgent setup, WorkflowAgent positioning, model routing, tools.
- [03 Data Access](./03-data-access.md): intermediate Postgres usage, read-only query tool, result handling.
- [04 Agent Skills](./04-agent-skills.md): local skill format, activation policy, initial domain skills.
- [05 Frontend UX](./05-frontend-ux.md): Claude-like chat shell, sidebar sections, search modal, thinking/tool-call rendering, artifact panel.
- [06 Evals Observability](./06-evals-observability.md): V1 test set, run logs, metrics, Langfuse V2 path.
- [07 Implementation Plan](./07-implementation-plan.md): build phases, milestones, acceptance criteria.
- [08 Generative UI](./08-generative-ui.md): presentData tool, view spec, inline rendering.
- [09 Generative UI Plan](./09-generative-ui-plan.md): implementation plan for 08.
- [10 Clarification Question](./10-clarification-question.md): the askUser clarification-question tool.

## V1 Principle

Keep the agent powerful enough to answer real mall/store/city questions, but keep the operating surface narrow:

1. Query only the intermediate Postgres database.
2. Save every meaningful agent action as an artifact or event.
3. Use skills to steer domain behavior.
4. Use simple backend guardrails for safety and reliability.
5. Defer heavy governance, semantic modeling, and tracing products until V2.
