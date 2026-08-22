# 15 · Which check is merely flaky

**Wave** 4 · **Depends on** nothing · **Hot files** `server/utils/checks.ts`, the merge dialog
**Done when** a check that fails intermittently across sessions is named as flaky, and the
merge dialog says so next to the failure.

## Why

Merges are gated on the project's suite, so a check failing one run in five now blocks real
work and reads as broken code. Six worktrees a night against one suite is an accidental
reliability dataset that exists on this machine and nowhere else — and a gate people cannot
trust is a gate they route around, which loses the whole feature.

## Build

- Read `server/utils/checks.ts` and whatever it already persists per run. If per-check
  granularity is not recorded, the first half of this brief is recording it — with tests.
- Flakiness is per project and per check name: it has both passed and failed on the *same*
  commit, or it fails at a rate that a stable check does not. Pick one definition, write it
  in the comment, and keep it explainable in a sentence to a person reading the dialog.
- The merge dialog says **this failure is a known flake** with the rate, next to the existing
  failure text. It must not change what the gate does — the person decides, better informed.
- A check with too little history says nothing at all. Silence beats a guess here.

## Acceptance

- `make check` green, with tests for: never failed, always fails, alternates on one commit,
  three runs total (not enough history).
- By hand: the wording is understandable to somebody who has not read this brief.

## Out of scope

Retrying a flaky check automatically. Quarantining it. Editing the project's suite.
