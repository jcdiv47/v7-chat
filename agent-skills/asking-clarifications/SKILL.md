---
name: asking-clarifications
description: Use when a request is ambiguous and you are deciding whether to ask the user a clarification question. Covers when askUser is warranted, how to phrase questions and options, and the exact input shape.
---

# Asking Clarifications

Ask the user with the `askUser` tool only when the request is genuinely
ambiguous **and** the answer changes what you would do. The run ends at the
question — nothing else executes until the user answers — so asking has a real
cost. Decide first; ask second.

## When to ask (and when not to)

Ask when the ambiguity forks the analysis:

- A vague measure with no data to back the obvious reading ("best mall",
  "strongest brand" — there is no revenue or traffic; the user must pick a
  proxy).
- A scope that materially changes the result (all statuses vs. currently
  operating; one city vs. nationwide; per-mall vs. per-city grain).
- A timeframe the data can slice several ways and the results diverge.

Do **not** ask when:

- A reasonable default reading exists — state the assumption in your answer and
  proceed. ("Counting all statuses; say the word if you want operating only.")
- The answer is discoverable from the schema or a cheap query — inspect or
  query instead of asking.
- The user already answered it earlier in the thread — never re-ask.
- The choice barely changes the result — pick one and note it as a caveat.

Prefer asking **before** running SQL, not after you already have results that
one of the answers would invalidate.

## Input shape

```json
{
  "questions": [
    {
      "question": "Which measure should define \"best\"?",
      "kind": "single",
      "options": [
        { "label": "Store count", "description": "Number of stores per mall" },
        { "label": "Floor area", "description": "Mall area in m²" },
        { "label": "Curated rank", "description": "Only ~10% of malls have one" }
      ]
    }
  ]
}
```

- `questions`: 1–3 entries. Batch **every** clarification you need into this
  one call — you cannot ask a follow-up until the user answers.
- `kind`: `"single"` when exactly one choice makes sense (a measure, a
  timeframe); `"multi"` when combinations are valid (which cities to include).
- `options`: 2–5 per question. Each needs a short `label`; add a `description`
  only when the trade-off is not obvious from the label.

## Crafting the questions

- Make options concrete and mutually exclusive, phrased in the user's terms
  ("Last 30 days"), not implementation terms ("filter open_date >= …").
- Lead with the option you would default to if forced to guess.
- Do not add an "Other" / "Something else" option — the answer card already
  provides a free-text Other field for every question.
- Keep each question independently answerable; don't make option lists depend
  on the answer to a sibling question.

## Mechanics

- Call `askUser` at most once per turn, and call **no other tool in the same
  step** — the loop stops at the question, so sibling calls are wasted.
- Do not promise work "after you answer" in accompanying text; just ask. The
  answers arrive as the next user turn and you act on them then.
- The user may ignore the card and type something else — treat whatever
  arrives next as the intent and do not re-ask.
