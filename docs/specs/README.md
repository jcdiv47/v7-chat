# Agentic Business Data Analysis App Specs

Status: Draft V1  
Last updated: 2026-07-04  
Owner: scishang/v7

This directory captures the product and technical specs for the V1 agentic business data analysis app.

## Decisions Already Made

- Convex is the application backend and state/control plane.
- Streaming survives browser refresh: the chat stream endpoint is a Convex HTTP action running the agent loop, with `@convex-dev/persistent-text-streaming` persisting JSONL-encoded UI message parts as the source of truth for live output.
- V1 runs as a single anonymous user; Clerk authentication is a V2 item.
- Agent skills are bundled into the Convex deployment at build time; the TUI reads the same skill files from disk.
- Messages are stored as AI SDK UI messages with full parts fidelity; prior-turn history is compacted before being sent to the model.
- Business analysis queries run only against a separate intermediate Postgres database.
- Raw business Postgres is outside the agent runtime path.
- V1 database scope is small: `cities`, `malls`, and `stores`.
- AI SDK V7 `ToolLoopAgent` is the primary interactive agent runtime.
- AI SDK V7 `WorkflowAgent` is reserved for durable or long-running workflows.
- OpenRouter is the first-class model provider for V1.
- Provider-native skill upload is not required for V1; use provider-neutral local agent skills.
- Langfuse is deferred to V2, but V1 should log enough run metadata to migrate later.
- Full semantic layer and strict SQL governance are V2 concerns.

## Spec Index

- [00 Product Scope](./00-product-scope.md): product goals, non-goals, user workflows, assumptions.
- [01 System Architecture](./01-system-architecture.md): services, runtime boundaries, data flow, deployment shape.
- [02 Agent Runtime](./02-agent-runtime.md): ToolLoopAgent setup, WorkflowAgent positioning, model routing, tools.
- [03 Data Access](./03-data-access.md): intermediate Postgres usage, read-only query tool, result handling.
- [04 Agent Skills](./04-agent-skills.md): local skill format, activation policy, initial domain skills.
- [05 Frontend UX](./05-frontend-ux.md): Claude-like chat shell, sidebar sections, search modal, thinking/tool-call rendering, artifact panel.
- [06 Evals Observability](./06-evals-observability.md): V1 test set, run logs, metrics, Langfuse V2 path.
- [07 Implementation Plan](./07-implementation-plan.md): build phases, milestones, acceptance criteria.

## V1 Principle

Keep the agent powerful enough to answer real mall/store/city questions, but keep the operating surface narrow:

1. Query only the intermediate Postgres database.
2. Save every meaningful agent action as an artifact or event.
3. Use skills to steer domain behavior.
4. Use simple backend guardrails for safety and reliability.
5. Defer heavy governance, semantic modeling, and tracing products until V2.

