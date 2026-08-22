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
