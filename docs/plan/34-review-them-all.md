# 34 · Review them all at once

**Wave** alone against `app/pages/land.vue` · **Depends on** nothing
**Hot files** new `server/api/github/pulls/review-all.post.ts`, `app/pages/land.vue`,
`test/reviewAll.test.ts`
**Done when** the "Waiting for your review" band starts a review session for every pull
request in it with one press, and says what that will cost before it does.

## Why

26 of the 132 sessions on this machine are reviews of somebody else's branch, and every one
of them was started the same way: read the row, press, wait for a worktree, paste
`/haddock-tech:review <url>`, go back, do it again.

Every part of doing it N times already exists. `intentFor` and `turnForIntent`
(`server/utils/reviews.ts`) already produce the right first turn for a `review` intent.
`POST /api/github/pulls/work` already does exactly one of these, including the detached
checkout (`detach: intent === 'review'`). `POST /api/sessions/batch` already has the cap, the
budget check and the per-item failure shape for doing many things at once — its own comment
says it: *"The work was parallel; setting it up was not."*

Nothing composes them. This is that composition and nothing else.

## Build

**1. `POST /api/github/pulls/review-all`.** Takes the pull request numbers. Per pull it does
what `work.post.ts` does with `intent: 'review'`, and returns the `BatchResult` shape already
used by `sessions/batch.post.ts` — `started` and `failed`, so a partial result is legible
rather than an exception.

**2. `MAX_AT_ONCE`, reused rather than re-chosen**, and refused rather than truncated, for
the reason `batch.post.ts` gives.

**3. One `checkBudget()` for the press**, not one per pull. A refusal starts nothing; five
sessions started and the sixth refused for spend is the worst of both.

**4. The control says the cost.** "Review all 5" sits on the band's heading, and the sentence
under it names both halves of what is about to happen: five sessions, and five full checkouts
of this repository. On the repository this is for, that is 1.9 GB each. Copy in the house
voice: what will happen, before it happens.

## Acceptance

Mechanised against a scratch repository with `CLAUDE_DIR` pointed at a temporary directory:

- N pulls in, N sessions out, each on its own worktree, each detached at that pull's head.
- Above the cap: refused, and nothing started.
- A budget refusal: nothing started, and the reason is the budget's own sentence.
- One pull failing to check out does not stop the others, and comes back in `failed`.

## Out of scope

**Sending the reviews.** The composer already exists (`reviewDraft.ts`, `reviewPost.ts`) and
it is deliberately one read and one press per review — *"No agent reaches this"* is the
property that makes it safe, and a batch send would be the one change that breaks it. This
unit starts the work; a person still finishes each one.
