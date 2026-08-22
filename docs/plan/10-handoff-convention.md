# 10 · The hand-off convention, documented

**Wave** 1 · **Depends on** nothing · **Hot file** `README.md`
**Done when** the README explains how someone who has never opened this app hands work to
it, in a section a non-programmer can follow.

## Why

A convention people trust is worth more than a second integration. The mechanism (a label)
is trivial; the value is entirely in the promise being written down: who may use it, what
happens next, how long it takes, and what will never happen.

## Build

- A short section in the README, in its existing voice — read three neighbouring sections
  before writing a word.
- Cover: the label (`studio`), who may add it, what happens (a worktree and a first turn,
  no push, no merge), how long before something appears, that a human reads everything
  before it lands, and what the app will never do to their issue.
- Cross-reference the issue band and the write-back setting.

## Acceptance

- `make check` green (docs only, so this is the typecheck being unbothered).
- Read it aloud. If a sentence needs an engineer to parse it, rewrite it.

## Out of scope

Code of any kind.

## Findings

- **The section documents units 06, 07 and 09, which are in waves 2, 3 and 5.** This unit is
  wave 1, so between merging this and merging those, the README describes a Land issue band
  and a write-back setting that are not in the code. That is the plan's own sequencing —
  documentation deliberately ahead of the mechanism — and the brief asked for the
  cross-references by name, so they are written as present-tense fact rather than hedged.
  What it costs: `README.md` is the npm and GitHub front page, so if wave 2 or 3 slips, the
  front page is wrong about a band that isn't there. Two ways out if that happens: hold this
  merge until 07 lands, or drop the first bullet of the list (the one starting *The issue
  turns up in Land's issue band*) and keep the rest, which is true today.
- **What is already true today**, and what the section is safe about: a ritual with an
  `issue_labelled` trigger and a `studio` label filter already works — `server/utils/eventTriggers.ts`
  polls `repos/{owner}/{repo}/issues/events` and `server/utils/scheduler.ts` polls it every two
  minutes, which is where *within a couple of minutes* comes from. Sessions already get their
  own branch and checkout and already push and merge nothing on their own.
- **Two numbers in the copy are read off the code**, so they are the things to re-check if
  either changes: *within a minute* for the issue band is `TTL_MS = 60_000` in
  `server/utils/wallPulls.ts`, which brief 06 says to copy; *a couple of minutes* for the
  ritual route is `POLL_MS = 2 * 60_000` in `server/utils/scheduler.ts`.
- **The prompt-injection line was worth writing down and is now a promise in public.** The
  section states that an issue's text reaches the session quoted in the prompt and never the
  standing brief or a system prompt, cross-referenced to the paragraph that already says it
  for Slack and Notion titles. Brief 07 has to keep that (it already says so); if it cannot,
  this paragraph has to come out at the same time.
- **A ritual is not a worktree.** The brief's *a worktree and a first turn* is the brief 07
  path, pressed by a person. The `issue_labelled` ritual route runs in the project directory,
  not a checkout of its own, so the section keeps the two apart rather than promising a
  worktree for the automatic one.
- No new dependencies, no code, no tests. `make check` green: 146 files, 2226 tests,
  typecheck clean. `test/terminal.test.ts` got its pty in this worktree and passed.
