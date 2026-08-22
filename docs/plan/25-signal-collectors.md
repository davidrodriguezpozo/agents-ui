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
