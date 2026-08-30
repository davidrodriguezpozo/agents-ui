# 33 · Fix the CI on the pull requests that are yours

**Wave** alone against `server/utils/eventTriggers.ts` · **Depends on** nothing
**Hot files** `server/utils/eventTriggers.ts`, the trigger editor in `app/pages/schedules.vue`,
`test/eventTriggers.test.ts`
**Done when** a ritual can fire on *a check that failed on a branch with an open pull request
you authored*, and not on the fifty other failures a shared monorepo produces in a morning.

## Why

Read off this machine's own run records: **"Let's fix the CI here: `<pull request url>`"**,
typed by hand, five separate times, in one month. Once with `(lint)` in it. It is the most
repeated instruction in the corpus after the review command itself.

The trigger for it already exists and cannot express it. `check_failed`
(`eventTriggers.ts:201`) polls `gh run list`, keeps the completed failures, and narrows them
with `.filter(row => !branch || row.headBranch === branch)` — so the two settings available
are **every failing workflow run in the repository** and **one branch, named in advance**.

In `agents-ui` that is fine. In the repository where 77 of this machine's 132 sessions
happened — a monorepo shared with colleagues — the first fires on everybody's failures and
the second names a branch that changes with every pull request you open. So the ritual that
should exist has never been created, and the instruction gets typed instead.

## Build

**1. A scope on the trigger, not a second trigger kind.** `check_failed` gains
`scope?: 'any' | 'branch' | 'mine'`, defaulting to today's behaviour so every schedule
already on disk keeps firing exactly as it does now. `branch` is what the existing `branch`
field already means; `mine` is the new one.

**2. `mine` costs one extra `gh` call per poll.** `gh pr list --author @me --state open
--json number,url,headRefName,title` in the same repository, then the failing runs are
intersected with those `headRefName`s. One call, not one per run, and it happens on a poll
that was already asking GitHub something.

**3. The event names the pull request, not the branch.** `TriggerEvent.summary` is what the
instruction is handed, and the work is about a pull request: `#5762 fix(products): … — Lint
failed`. The `url` is the pull request's, because that is what a person opening the row wants
and what the instruction will quote.

**4. Everything about pacing stays exactly as it is.** `MAX_EVENTS_PER_POLL = 3`,
`reachedBackOf`, and the rule that the high-water mark only advances past what actually
fired. A morning where four of your pull requests go red is three runs and then three more,
not seven at once.

## Acceptance

Mechanised, against fixtures rather than a live repository — a session cannot make a real
check go red on demand:

- A failing run on a colleague's branch does not fire under `mine`, and does under `any`.
- A failing run on a branch with an open pull request you authored fires, and the event
  carries the pull request's number and url rather than the workflow's.
- An in-flight run never fires under any scope.
- `gh pr list` failing retires nothing and fires nothing — the same rule
  `reviewRetire` already states for an unreachable GitHub: not knowing is not an answer.
- A schedule written before this field exists behaves identically. Assert it from a fixture
  of the old shape, not by reasoning about the default.

## Out of scope

Fixing the CI. That is the instruction the ritual carries, and it is already the thing this
app is for. Also out: pull requests authored by somebody else that you have been asked to
fix — that is a review-requested trigger, and it exists.
