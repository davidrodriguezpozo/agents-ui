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
