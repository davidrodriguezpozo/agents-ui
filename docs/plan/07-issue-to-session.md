# 07 · The issue row becomes a session

**Wave** 3 · **Depends on** 06 · **Hot file** `app/pages/land.vue`
**Done when** one press on an issue row cuts a worktree and starts a turn that knows the
issue's number, title, body and comments, and the session says which issue it came from.

## Why

A list of links cannot do the one thing that matters. The pull-request band already turns a
row into a session; this is the same move from the other side of the workflow, and it is
what makes the label convention worth anything.

## Build

- Read how the PR band builds its prompts (`server/utils/landing.ts`, `lander.ts`,
  `server/api/landing/*`) and follow it exactly, including re-reading GitHub at the moment
  of the press rather than trusting the drawn row.
- The prompt: what the issue asks for, its comments in order, and the instruction to
  investigate before changing anything. **The issue body goes in the session prompt. It
  never goes near the standing brief or a system prompt** — see the rule in
  `server/utils/brief.ts` and keep it.
- Branch named from the issue number and slug. The session records the issue URL so the row
  can say **Has a session already**.
- Two actions, not one: *investigate and report*, and *do it*. The first commits nothing.

## Acceptance

- `make check` green, with tests for prompt composition (no comments, many comments, a body
  containing something that looks like an instruction to the reader — it stays quoted data).
- By hand: press it on a real issue, read the first turn, check it understood the ask.

## Out of scope

Commenting back on the issue — brief 09. Closing issues, ever.
