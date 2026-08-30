# 37 · The model on the run, and the ledger by provider

**Wave** alone against `server/utils/outcomes.ts` · **Depends on** nothing
**Hot files** `server/utils/providers/claude.ts`, `server/utils/providers/cursor.ts`,
`server/utils/runStore.ts`, `server/utils/outcomes.ts`, the Ledger tab on `app/pages/work.vue`,
`test/outcomes.test.ts`
**Done when** a finished turn records the model it ran on, and the ledger can group outcomes
by agent as well as by model — with records that predate either shown as not recorded rather
than as a group.

## Why

Two facts found by reading this machine's store, both invisible from every screen:

**`outcomes.ts:230` reads `run.stats?.model`, and nothing writes it.** All 538 run records on
this machine carry `usage`, `costUsd`, `durationMs` and `numTurns`. None carries a model. So
`OutcomeReport.byModel` — half of what units 11 and 12 were for — is a single bucket called
`undefined`, on the page whose purpose is saying which choices earn their cost. Unit 11
predicted the shape of this ("`RunSummary` … carries neither the model nor the repository")
and fixed the repository half only.

**Every run since the seam records a `provider`, and the report cannot group by it.** 134
`claude`, 3 `cursor`, 401 from before the field existed. `OutcomeReport` has `byAgent`,
`byModel` and `byRepository`. The one comparison this app could honestly make today is the
one it does not offer — and unit 35 makes it the question that decides a default.

## Build

**1. The model, recorded where the turn ends.** Each provider already surfaces what it ran;
put it on `stats.model` alongside `costUsd`. Written by the provider rather than by the
caller, so a third one added later cannot forget on someone else's behalf.

**2. `byProvider` on `OutcomeReport`**, beside the three that exist, filled from
`run.provider` through the same `outcomeTurnOf` mapping and rendered on the Ledger tab as a
fourth grouping. No new join and no second reader of the run store.

**3. Absent is not a bucket.** Records written before either field say **not recorded**, with
their count, rather than being tallied under a group named `undefined`. This is the whole
difference between a page that admits its window predates the measurement and one that
invents a model called nothing. Unit 11 already chose this rule for changed files —
`changedFiles.measured` — and this follows it rather than inventing a second convention.

## Acceptance

- A run record produced by a turn carries `stats.model`.
- `joinOutcomes` groups by it, and by provider, over a fixture holding all three eras:
  pre-seam (no provider, no model), post-seam (provider, no model), and post-this-unit.
- The three eras are reported as one "not recorded" count each where they cannot be grouped,
  and the buckets plus that count add back up to the total — the property unit 11 wrote its
  four buckets to have.

## Out of scope

Choosing a cheaper model for anything. That is a direction of its own and it needs this unit
first, which is most of the argument for doing this one now: today the app cannot even say
what it has been spending its money on.

## Findings

- **Claude was the provider getting this wrong, and Cursor was already right.**
  `cursor.ts` has read `msg.model` off its own stream since unit 31 (`model ?? options.model`,
  twice). `claude.ts` recorded `options.model` alone — which is set only when somebody names a
  model, and on this machine that had happened **7 times in 540 runs**. So the fix is not new
  behaviour, it is the older provider catching up with the newer one, and it is four lines.
- **`answeringModel` is exported and tested, rather than left inline.** `claude.ts` had no
  exported helpers at all, but `cursor.ts` exports two for exactly this reason, and the rule
  has a decision in it: last one wins, an empty string is absent, and a non-assistant message
  never contributes. Testing the fold rather than only the extractor is what makes "last one
  wins" a claim rather than a comment.
- **Absence is resolved in `byProvider`, not dropped.** Every other dimension leaves out a
  turn it cannot key. This one cannot: 401 of the 538 records on this machine predate the
  provider field and every one ran on Claude Code, so `providerFor` resolves them the same way
  every other reader does. It is the only dimension whose groups add back up to the window's
  total, and there is a test asserting exactly that.
- **The table is called "By what ran it", not "By agent".** `byAgent` already means the
  persona a turn ran as. Two tables called agent — one about Claude Code versus Cursor, one
  about `code-reviewer` — is a column somebody misreads exactly once, and the misreading is
  expensive because both are plausible.
- **What is still not true: the 538 records already on disk gain nothing.** They have no model
  and they never will; back-filling would mean guessing. The model grouping is honest from
  today forward and empty behind, which is the same trade unit 14 made with `sha` on old
  landings.
