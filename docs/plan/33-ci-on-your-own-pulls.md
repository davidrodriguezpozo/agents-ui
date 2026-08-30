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

## Findings

- **The trigger editor is not in `app/pages/schedules.vue`.** It is
  `app/components/ScheduleModal.vue`, which the page opens. The scope control went there,
  next to the kind select: three buttons — *Anywhere*, *One branch*, *Your pull requests* —
  shown only for `check_failed`, with the branch box appearing only under *One branch*.
- **`scope` is compared as what it means, not as what is stored.** `upsertSchedule` drops a
  trigger's cursor whenever the question changes, and a ritual saved before this field
  existed says the same thing as one whose `scope` spells out what its `branch` already
  implied. Comparing the raw field would have re-baselined every old `check_failed` ritual
  the first time somebody opened and saved it. `checkScopeOf` is the comparison, and
  `test/scheduleStore.test.ts` holds both halves.
- **The key stays the workflow run's `databaseId` under `mine`,** not the pull request
  number. A pull request goes red, gets pushed to, and goes red again; keyed by pull request
  the second failure is not news and would never fire — which is the firing you most want.
- **Matching is by head branch name,** because that is the only thing `gh run list` offers.
  Two of your *own* open pull requests can only collide on it across forks; the first wins,
  and the cost is a summary naming the wrong one of your pull requests, not a wrong ritual.
- **`gh pr list` gets `--limit 50`,** matching `LOOKBACK` rather than `gh`'s default thirty.
  A truncated listing is indistinguishable from a pull request that is not yours, so the two
  windows have to agree.
- **What remains unproven.** The intersection, the scopes, the in-flight rule, the
  unreachable-GitHub rule and the old-shape fixture are all mechanised in
  `test/eventTriggers.test.ts` against `checkEventsFrom`. What no session can perform is the
  live half: that `gh pr list --author @me` in a real shared repository returns what
  `checkEventsFrom` is fed, and that a real failing check on a real pull request of yours
  starts a run. Somebody with an open pull request and red CI has to create the ritual once
  and watch it fire.

## Out of scope

Fixing the CI. That is the instruction the ritual carries, and it is already the thing this
app is for. Also out: pull requests authored by somebody else that you have been asked to
fix — that is a review-requested trigger, and it exists.
