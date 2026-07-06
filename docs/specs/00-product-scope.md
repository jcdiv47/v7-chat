# 00 Product Scope

## Product Summary

The app is an agentic business data analysis tool for asking natural-language questions about mall, store, and city data. Users interact through a chat-first UI. The agent writes and executes read-only SQL against an intermediate Postgres database, then returns answers, tables, charts, and saved analysis artifacts.

The V1 product should feel like an internal analyst that can inspect a small business dataset, run follow-up queries, and explain findings clearly.

## Primary Users

- Business operators who need quick answers about malls, stores, and cities.
- Analysts who want SQL transparency and reusable outputs.
- Internal builders who need a fast iteration loop through the TUI before polishing UI workflows.

## Core Jobs To Be Done

- Ask a plain-English business question.
- Let the agent inspect available tables and columns.
- Generate and run read-only SQL.
- See the SQL, result table, chart, and narrative answer.
- Refresh or leave the page mid-run and come back to the still-running analysis.
- Save or revisit an analysis run.
- Test agent behavior locally before shipping UI changes.

## V1 Goals

- Build a usable chat-based analysis app.
- Treat OpenRouter as the first-class model provider.
- Use AI SDK V7 `ToolLoopAgent` for the interactive agent loop.
- Use AI SDK V7 agent skills to curate domain-specific behavior.
- Store app state, runs, messages, stream chunks, tool events, and artifacts in
  Postgres through the app backend.
- Make in-flight runs resumable: a browser refresh mid-run reattaches to the live thinking, tool-call, and answer stream.
- Query only the intermediate Postgres database.
- Support basic table/chart/narrative outputs.
- Provide a TUI entrypoint for fast local testing.

## V1 Non-Goals

- No direct agent access to raw business data.
- No model writes to Postgres.
- No full semantic layer.
- No full SQL policy engine or deep AST governance.
- No Langfuse integration yet.
- No authentication or user accounts: V1 runs as a single anonymous user.
- No provider-native skill upload requirement.
- No multi-provider model strategy beyond OpenRouter.
- No complex data catalog product.

## V2 Candidates

- Semantic layer with metric definitions, join rules, grains, owners, freshness, caveats, and examples.
- Strict SQL validation with parser-based enforcement, cost checks, policy rules, and approval gates.
- Langfuse tracing and evaluations.
- Durable multi-step workflows with `WorkflowAgent`.
- Scheduled or background analysis jobs.
- More datasets and tenant-specific metadata.
- User-editable skill or prompt configuration.
- Clerk authentication with real user accounts and org scoping.

## Initial Dataset

The intermediate Postgres database currently contains only:

- `cities`
- `malls`
- `stores`

The exact column names should be discovered from the database at implementation time. Domain skills can document confirmed relationships once the schema is inspected.

## Success Criteria

V1 is successful when:

- A user can ask 15-30 common mall/store/city questions and get grounded answers.
- The app shows generated SQL for trust and debugging.
- Every run records active skills, model alias, SQL, result preview, final answer, and errors.
- The TUI can run the same agent logic used by the web app.
- Refreshing the browser during a run never loses the run: the client reattaches and the answer completes.
- Basic reliability controls prevent runaway queries and accidental writes.

## Open Product Questions

- Should analysis artifacts be shareable by URL in V1?
- Should users be able to pin or name important runs?
- Should the agent ask clarification questions before SQL when the prompt is ambiguous, or make a best-effort query with caveats?
