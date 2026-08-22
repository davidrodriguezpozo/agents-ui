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

## Findings

**Dependency is a constraint on the order; cost is how the order is chosen inside
it.** The brief reads as though dependency replaces the existing ordering, and
that would have thrown away something `planLanding` documents at length: cheapest
first means the already-green sessions merge before anybody has paid for an
update, so the ones that do need updating get one update covering all of it
rather than one each. Both are kept. `orderTrain` is Kahn's algorithm with the
ready set drained in cost order — dependency decides where it must, and
everything it leaves free is ordered exactly as before. Dependency edges are
rare, and an ordering that reshuffles a page of independent sessions for no
reason is one nobody trusts.

**The edge is "defines a name you use", not "removes one".** Brief 21's symbol
map read for a different question than brief 22 asks of it: not *what does this
merge break* but *what does this merge settle*. A name a session takes away is
somebody else's breakage and already has an answer in `collisions.ts`; a name it
defines is somebody else's dependency, and merging the definition first means the
caller is re-checked once, against finished code. `MIN_NAME_LENGTH` is shared
with `collisions.ts` for the same reason it exists there: `id` and `fn` are
declared and used independently all over a repository.

**A session that defines a name for itself is excluded**, the same exclusion
`findCollisions` makes — their use of it is theirs, whatever anybody else is
defining elsewhere.

**A cycle falls back and says so, rather than guessing which half to break.**
Two sessions that use each other have no order that avoids a re-check, so the
answer is the cheapest-first order and a sentence saying no order would have
helped. Tested with a cycle on its own and with a cycle beside an independent
session, because the second is where a naive implementation loops or drops rows.

**The order is read once and used twice.** `namesIn` lives beside `candidatesIn`
in `lander.ts` and both the plan endpoint and `startLanding` call it, because the
plan endpoint's own comment is right: a client — or a second code path — that
re-derives the order is how the picture and the button come to different
conclusions. It never throws: one unreadable worktree is one session with no
edges, which is the same as a session nothing depends on, and the order is still
correct on cost alone.

**The sentence is composed on the server and rendered as given.** The reason is a
fact about the dependencies the server read; a page that wrote its own would be
describing an order it did not decide. It appears once above the rows rather than
as a badge on each of them, and only when there is more than one thing to order.

**Verified end to end, not only in units.** `make check` green — the brief's four
cases (independent sessions, a chain of three, a cycle, a session with no
verdict) are in `test/trainOrder.test.ts`, plus the tie-breaks and stability
between two reads. Beyond that: a scratch repository with three real git
worktrees — one defining `renderChart`, one calling it, one touching neither —
three session records seeded deliberately in the order b, a, c, and a dev server
on a chosen port with `CLAUDE_DIR` pointed at a throwaway store.
`GET /api/landing/plan` returned the queue as **a, b, c** with

> Ordered so changes land before the sessions that use them: "Rename the chart
> helper" defines `renderChart`, which "Chart the results" calls. Merging the
> other way round means checking against a definition that is about to change.

and the Land page drew the rows 1, 2, 3 in that order with that sentence above
them. The symbol came out of a real `git diff`, not a fixture.

**Not done, and named in the brief as out of scope.** "Bring the base in and
re-check once per pass rather than per session, and say which sessions were
re-verified as a result" is the second bullet of *Build* and is a change to how
`startLanding` runs the queue, not to how the queue is ordered — it belongs with
brief 24 (`Bring the base in, for all of them`), which is wave 8 and depends on
this one. Ordering by dependency is what makes that pass worth batching; the
batching itself is left where the plan already puts it.
