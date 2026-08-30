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

## Findings

- **The cost sentence names the checkouts but not their size.** The brief's "1.9 GB each"
  is true of this repository and of no other, and nothing on the machine can answer the
  question cheaply: a session worktree shares the object store, so the cost is the working
  tree, which means `du` over gigabytes on every render of a band that polls every two
  minutes. Hard-coding one repository's figure onto every repository's band would be the
  kind of confidently wrong number this app is supposed to not produce. So the copy says
  *"N sessions, one per pull request, each a full checkout of this repository"* — both
  halves, no invented number. A real figure would want a cached `worktreeSize(repoDir)`
  measured once per repository and refreshed on a timer; that is its own unit.
- **`MAX_AT_ONCE` is now exported from `server/api/sessions/batch.post.ts`** and imported by
  `review-all.post.ts`, which is one route module importing another. That is the literal
  reading of "reused rather than re-chosen" and it is one word of change; the alternative —
  a `server/utils/` file holding one number — is a file whose why-comment would be longer
  than its contents. If a third caller appears, that is the moment to lift it.
- **The band's count is the rows that have a `review` intent, not the whole band.**
  `intentFor` gives a non-mine *draft* no intent, so it has no button on its row — and
  counting it would make "Review all 5" produce four sessions. The endpoint still forces
  `intent: 'review'` on whatever numbers it is handed, exactly as `work.post.ts` lets an
  explicit intent beat the row's suggestion.
- **The control appears from two upwards.** On a single row it would be a second button
  doing what the button already on that row does.
- **Unproven: the press itself.** `test/reviewAll.test.ts` drives the real handler against a
  scratch repository with a real `origin` carrying real `refs/pull/N/head` refs, so the
  fetch, the detached worktree and the session records are the real ones — the only stub on
  that path is `gh pr view`, which is not reachable from a test. What no test here covers is
  the button in a browser: that the count reads right, that it goes to "Starting…" and back,
  and that the toast says what happened. Somebody has to open `/land` on a repository with
  two or more reviews waiting and press it.
