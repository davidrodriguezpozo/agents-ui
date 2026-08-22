# 11 · The outcome join

**Wave** 1 · **Depends on** nothing · **Hot files** new `server/utils/outcomes.ts` + tests
**Done when** one server util can answer, for any window: what was spent, what landed, and
what the checks said — grouped by ritual, agent, model, skill and repository.

## Why

This is the load-bearing piece of the whole ledger, and it is a join rather than a rewrite.
`server/utils/spend.ts` holds what everything cost. `server/utils/landed.ts` holds what
shipped and by which of three routes. `server/utils/checks.ts` holds whether it held up.
Nobody else in the field can build this because nobody else records the merge.

## Build

- Read those three files and the run records behind `server/api/runs/index.get.ts` before
  designing anything. **Do not add a store.** This reads what exists.
- Shape it as pure functions over loaded records — that is what makes it testable and what
  makes every later brief cheap.
- The numbers that matter: spend per accepted merge; spend that produced nothing; count of
  landings by route; share of turns that changed files; side costs (the summary line) kept
  separate rather than folded in.
- Be honest about attribution in the code comment: a session's cost includes turns that
  were a person changing their mind, and a subscription's dollar figures are notional. Say
  which numbers are exact and which are indicative — a ledger that overclaims is worse than none.

## Acceptance

- `make check` green, with tests over fixtures for: nothing landed, one landing, a landing
  merged on github.com by someone else, a session set aside, a day with only side costs.
- No UI in this brief at all.

## Out of scope

Any page. Any new store. Reverts — brief 14.

## Findings

- **`RunSummary` cannot carry this join.** It is what a list view needs and has
  neither `model` nor `projectDir`, so nothing loaded through `runsSince` or
  `listRuns` can be grouped by model or by repository. `joinOutcomes` therefore
  takes a structural `OutcomeTurn`, and `outcomeTurnOf` maps the **run record** —
  which has both, plus `stats.costUsd` and the events. Whoever builds the
  endpoint either reads run records or adds those two fields to `summarize`; two
  lines, but a change to a type six surfaces already read, so it was left alone
  here.
- **Nothing records whether a turn changed a file.** Recovered from the event log
  in `turnChangedFiles`, which means the honest denominator is "turns we could
  measure", reported as `changedFiles.measured` rather than folded into a share
  that quietly counts unloaded turns as turns that changed nothing. Two known
  gaps: a turn that only ever edited through `Bash` undercounts, and reading a
  month of events means opening every run file. If that becomes the cost of the
  page, the flag wants writing onto the run at the end of the turn.
- **Decisions taken, since nobody was there to ask.** Spend is attributed per
  turn from the fate of its session, so within any group the four buckets
  (landed, abandoned, open, unattributed) add back up to the group's cost.
  Landings are attributed per session to the group of its last costed turn in
  the window, so a session run under two models counts its landing under one of
  them and group totals never exceed the overall. Landings are counted by when
  they landed while spend is counted by when it was spent — the two windows
  genuinely differ, and reconciling them would mean lying about one. A turn with
  no value for a dimension is left out of it rather than put in an "unknown"
  bucket, so a dimension's groups can sum to less than the total.
- **`landedSince` narrows the record but is typed on the session**, so callers
  re-check `landed` after the filter. Worth a `T & { landed: SessionLanded }[]`
  return type one day; not this brief's file.
