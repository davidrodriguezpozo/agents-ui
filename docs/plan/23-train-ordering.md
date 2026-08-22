# 23 · A train that orders itself

**Wave** 7 · **Depends on** 22 · **Hot files** merge train on Land
**Done when** Ready here is ordered so that merging top to bottom minimises re-verification,
and the page says why that order.

## Why

Merging one session invalidates every other session's verdict against a base that no longer
exists. The app already says how far behind a session is; this acts on it, and turns six
sequential re-checks into one pass.

## Build

- Order by dependency from brief 21's map: a session whose changed names others use goes
  first. Ties broken by checks-green, then smaller diff.
- Bring the base in and re-check **once per pass** rather than per session, and say which
  sessions were re-verified as a result.
- The order is explained on the page in one line. An unexplained reordering of somebody's
  work reads as a bug.
- A cycle is possible. Say so and fall back to the current order rather than looping.

## Acceptance

- `make check` green, with tests for: independent sessions, a chain of three, a cycle, one
  session with no verdict.
- By hand: three sessions, one obviously depending on another, order is right.

## Out of scope

Merging without a press. Rebasing — brief 24.
