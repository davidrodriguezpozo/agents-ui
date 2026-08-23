# 27 · A board anyone can read

**Wave** 9 · **Depends on** 11, 17 · **Hot files** a new page
**Done when** one page says what shipped, by day, in sentences a non-engineer can act on, and
can be shown to somebody who has never opened this app.

## Why

The one-sentence summary from `server/utils/sessionSummary.ts` is the piece every competitor
lacks — the desktop camp shows branch names, which nobody outside engineering can read.
Linear Releases does this from the issue side; this does it from local branches, which is the
half nobody has.

## Build

- Grouped by day, newest first: what landed, one sentence each, by whom, in which repository,
  and whether the checks were green when it went in.
- No branch names, no SHAs, no token counts, no jargon in the default view. Everything
  technical is one press away, not on the page.
- A day with nothing says so plainly. A week with nothing is a true and useful thing to show.
- Read-only. This page cannot start, merge or stop anything.

## Acceptance

- `make check` green.
- Show it to somebody who does not write code and ask what shipped yesterday. If they hedge,
  the copy is wrong.

## Out of scope

Publishing it anywhere. Sharing links. Anything that leaves the machine.

## Findings

**The jargon rule is structural, not editorial.** A row carries seven fields —
`sessionId`, `what`, `fromTitle`, `who`, `where`, `verdict`, `at` — and a test
asserts that list exactly. There is no branch, no commit, no fingerprint and no
cost on the row to leak, so no later template change can put one on the page.
"One press away" is a link to the session, which is where all of that already
lives.

**The row *is* the link.** Which gets three things at once: it is walkable with
the same keys as every other list in the app (`data-row`, and the page is on the
keyboard contract's list now), Enter opens it because a browser opens a link, and
there is nothing else on the row to press — so read-only holds by construction
rather than by discipline.

**An override is its own verdict, not a shade of red.** "This went in broken" and
"somebody decided this could go in broken" are different news, and only the
second has a person to ask. Four states, each rendered as words rather than a
colour: a tick and a cross are read differently by different people, and
*nothing was ever run* has no obvious icon at all.

**Whole local days, empty ones included.** A board read at 09:00 on a Monday
shows the whole of Friday rather than the twelve hours of it inside a rolling
week, and "Nothing shipped." is printed in the same voice as a day with something
in it — a list that silently skips days reads as a list still loading.

**One thing the real data changed.** The summariser's prompt says a trailing full
stop is fine either way, which is right for one line and wrong for ten on a wall:
half the rows ended in a stop and half did not, which reads as carelessness to
exactly the reader this page is for. `asSentence` normalises it. Presentation, so
it is done here rather than by asking the model again.

**Verified against real data.** `make check` green, and the board built from this
machine's own sessions: 10 things over 4 of the last 7 days, each a sentence, no
`branch`, `sha`, `commit`, `token`, `cost`, `fingerprint` or `worktree` anywhere
in the payload — asserted, not eyeballed. Then rendered in a browser against a
copy of the real sessions file: *Nothing shipped.* under Today, one row in amber
reading "merged with the checks failing", and a **Shipped** item in the sidebar.

**What the board cannot say yet, and it is the obvious question.** `who` is null
on every real row, because identity landed yesterday and every merge here predates
it. So the page reads as "this shipped" and not yet as "Ada shipped this" — which
is the first thing the intended reader will ask. Nothing is wrong; the records
simply have no person in them, and the page correctly omits rather than invents.
It fills in by itself as merges accumulate.

**The acceptance I cannot perform.** "Show it to somebody who does not write code
and ask what shipped yesterday. If they hedge, the copy is wrong." I read it as
that reader would and it holds up — the sentences are English, the verdict is a
phrase and not a colour, and the empty days are stated. But no actual
non-engineer has seen it, and that is the one test of this page that matters.
Turn the laptop around; if they hedge, the copy is wrong.
