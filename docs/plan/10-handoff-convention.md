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
