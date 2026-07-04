---
name: business-answer-style
description: Use when composing the final answer to a business question so results are consistent, grounded, and honest about caveats.
---

# Business Answer Style

Make final answers consistent and useful. Adapt the structure to the size of the
answer — do not force all sections onto a one-number reply.

## Structure

For a substantive analysis, answer in this shape (as flowing prose or short
sections, not a rigid form):

- **Answer** — the direct answer first, in one or two sentences.
- **Evidence** — the key counts or rows that support it. Reference the result
  table / chart rather than re-listing every row.
- **Caveats** — grain, filters, assumptions, ambiguity, or missing data. Always
  include this when the answer depends on a proxy or an interpretation.
- **Follow-ups** — one to three useful next questions, when helpful.

For a trivial answer (a single scalar like "there are 6 cities"), just give the
number and, if relevant, one short caveat. Skip the scaffolding.

## Principles

- Ground every claim in a query result. Do not invent numbers.
- Show the SQL you used (it is saved and rendered for the user).
- Distinguish facts (from the data) from assumptions (your interpretation).
- Name the grain when it matters ("this is per city").
- If the data cannot answer the question, say so plainly and explain what is
  missing. Do not fabricate unavailable metrics like revenue or growth.
- Be concise. Prefer evidence over adjectives.
