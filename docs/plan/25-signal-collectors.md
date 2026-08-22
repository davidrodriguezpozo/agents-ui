# 25 · The three signals

**Wave** 8 · **Depends on** 14 · **Hot files** new `server/utils/lessons.ts` + tests
**Done when** three kinds of failure are collected into one typed list of candidate lessons,
with enough context to write a rule from.

## Why

The input half of the learned-rules loop, kept separate from the writing half on purpose:
collection is mechanical and testable, proposing text is not. What Devin and Factory sell as
opaque cloud memory becomes, here, a list you can read.

## Build

- The three: work this machine landed that was later reverted (brief 14); the base branch
  going red shortly after a landing; the same permission or host denied repeatedly across runs.
- Each candidate carries: what happened, how often, which sessions, which files or tools, and
  when it last happened. No prose, no model involved.
- Deduplicate hard. The same lesson surfacing weekly is one lesson, with a count.
- Nothing is written anywhere near `CLAUDE.md` in this brief.

## Acceptance

- `make check` green, with tests for each signal, for deduplication, and for a signal that
  stops recurring (it ages out).
- Read the real list on this machine. If it is noise, the thresholds are wrong and this brief
  is not done.

## Out of scope

Proposing text — brief 26. Any UI.

## Findings

**One list, three collectors, and the collectors are not exported.** The public
surface is `collectLessons(input)` and the types around it. Each signal is a
function inside the file because the interesting behaviour is what the three do
*together* — dedup keys that do not collide, one threshold per kind, one window —
and a test that reaches past that into a single collector would be testing an
implementation rather than the list.

**Everything is a key, a count, a name or a timestamp.** There is one string in
the output that came from outside: a revert's subject line, which is git's own
and is carried so a row can point at the commit. No model is involved anywhere,
and there is a test asserting the shape of a candidate so that a later change
cannot quietly add a sentence somebody has to take on trust.

**The dedup key is the thing the lesson is about, never the occurrence.** Three
reverts in one repository is one lesson with a count of three, because three rows
would read as three unrelated accidents. A refused host and a refused tool of the
same name stay two lessons on purpose: one is fixed with a permission rule and
the other with a sandbox domain, and a lesson that cannot say which is not worth
acting on.

**Ageing out is the window, not a decay function.** A lesson is in the list while
the thing it is about is still happening, and the count only ever counts
occurrences inside the window — so a signal that stops recurring both loses its
place and shrinks on the way out.

**The base going red is not directly observable here, and the collector says so
in its own comment.** Nothing in this app runs the base branch's tests. What it
can see is every session in a repository beginning to fail a check that was
passing before a merge, which is the same event from the only place this app
stands. Two guards keep that from being a list of ordinary broken code: the check
has to have passed in that repository before the landing, and it has to fail
within a day of it.

**Thresholds: 1 for a revert, 2 for a red check, 3 for a denial.** A revert is
already a person deciding the work was wrong, so one is the signal. The other two
are noisy in ones — a check goes red for a hundred reasons, and a tool is refused
every time an unattended run meets one it was never granted.

## The real list on this machine

Read read-only against the live stores, which is the brief's second acceptance
line. 78 sessions, 309 runs in the 30-day window:

```
lessons: 1
  [denied] denied:host:api.fontsource.org ×5  last 2026-08-21T13:13  sessions=5
```

One row out of 78 sessions and 309 runs, and it is a real wall: five sessions
blocked on the same host, none of which took the offer to allow it. That is the
signal this brief is for, and it is not noise.

**But two of the three signals have no data here at all, so their thresholds are
unvalidated.** 10 landings and **0 reverts** in the window, and the check history
holds **0 repositories** — `recordCheckRun` files a verdict per project and
nothing on this machine has filed one yet, so `base-broken` has never had an
input. Both collectors are tested against fixtures and neither has met reality.
The honest reading of the acceptance line is: the denial threshold is right, and
the other two are a guess that the first real occurrence will confirm or correct.

That empty check history is worth a look on its own — it is the dataset brief 15
built and this brief expected to read, and one of the two is wrong about where it
lands. Not chased here: it is a finding about `checkFlakes.ts`, not about this
collector, and diagnosing it would have meant changing a file this brief was not
given.
