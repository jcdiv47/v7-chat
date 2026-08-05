# 04 Agent Skills

## Skill Strategy

Use AI SDK V7's provider-neutral local skills pattern for V1:

1. Discover local skill folders.
2. Inject only skill names and descriptions into the agent instructions.
3. Provide a `loadSkill` tool.
4. Let the agent load full skill instructions only when relevant.

This works with OpenRouter because it does not require provider-native skill upload.

Provider-native `uploadSkill` is not a V1 dependency. As of the current AI SDK V7 docs, native skill upload is documented for OpenAI and Anthropic providers, not OpenRouter.

## Skill Directory

Recommended project layout:

```txt
agent-skills/
  business-domain-analysis/
    SKILL.md
    references/
      schema.md
      query-patterns.md
      glossary.md
  business-answer-style/
    SKILL.md
  chart-selection/
    SKILL.md
  asking-clarifications/
    SKILL.md
```

## Skill Bundling

Skills are authored as files but bundled at build time so the deployed web
runtime uses a stable registry while local tooling can still read from disk:

- a codegen step inlines each `SKILL.md` (and its `references/` files) into a generated
  skill registry module deployed with the app
- `loadSkill` reads from that registry in the web runtime; the TUI reads the same files
  directly from disk
- `skillsVersion` is derived by the build (e.g. a content hash), so a skill edit always
  produces a new version on subsequent runs

## Skill Metadata Format

Each skill uses `SKILL.md` with YAML frontmatter.

```md
---
name: business-domain-analysis
description: Use when answering business questions about cities, malls, stores, brands, and whenever writing or revising SQL.
---

# Business Domain Analysis

Instructions go here.
```

## Activation Policy

Default visible skills:

- `business-domain-analysis`
- `business-answer-style`

Optional visible skills:

- `chart-selection`
- `asking-clarifications`

The agent should load a skill when:

- the user asks a domain question
- the user asks for a chart
- the user asks for an explanation of a result
- the agent is about to write SQL and needs query conventions
- the request is ambiguous and the agent is considering an `askUser` call

## Skill Versioning

Every run should store:

```ts
type SkillRunMetadata = {
  skillsVersion: string;
  discoveredSkills: string[];
  activeSkillNames: string[];
  loadedSkillNames: string[];
};
```

Example:

```txt
skillsVersion = "business-v1.a1b2c3d4"
```

This makes behavior changes debuggable.

## Skill: business-domain-analysis

Purpose:

- Teach the agent the business domain.
- Document relationships between `cities`, `malls`, and `stores`.
- Encourage grain-aware answers.
- Steer SQL generation and query iteration.

Key instructions:

- Start from `cities` for geography questions.
- Join `malls` to `cities` for city-level mall analysis.
- Join `stores` to `malls` for store-level analysis.
- State the grain of the answer: city-level, mall-level, or store-level.
- Use `left join` when looking for missing stores or empty malls.
- Do not assume revenue, traffic, lease, category, or time-series data unless columns exist.
- If the user asks about unavailable facts, say which data is missing.
- Inspect schema before relying on column names.
- Prefer simple CTEs with clear aliases; avoid unnecessarily complex SQL.
- Use `limit` for previews and aggregate queries for rankings and comparisons.
- Do not attempt writes.
- If SQL fails, revise based on the database error.

## Skill: business-answer-style

Purpose:

- Make final answers consistent and useful.

Recommended answer format:

```txt
Answer:
<direct answer>

Evidence:
<key counts or rows>

Caveats:
<grain, filters, missing data, or assumptions>

Follow-ups:
<1-3 useful next questions>
```

This should be adapted in the UI so it does not feel rigid for very small answers.

## Skill: chart-selection

Purpose:

- Help the agent choose useful chart types.

Rules:

- Use a table when exact rows matter.
- Use a bar chart for rankings and grouped counts.
- Use a horizontal bar chart when labels are long.
- Use no chart for single scalar answers.
- Avoid line charts unless a time column exists.
- Include chart title, dimension, measure, and source SQL artifact ID when possible.

## Tool Requirements

The `loadSkill` tool should return:

```ts
type LoadSkillOutput = {
  skillDirectory: string;
  content: string;
};
```

The tool should not allow arbitrary file reads outside approved skill directories. In
the web runtime this holds by construction: the bundled registry is the only source.

## Skill Safety

Skills steer behavior. They do not enforce behavior.

Enforcement still belongs in:

- database permissions
- `runSql` tool limits
- backend authorization
- run logging
