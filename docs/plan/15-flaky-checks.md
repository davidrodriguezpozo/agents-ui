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

## Findings

- **Per-check granularity was not recorded, and neither was anything else.**
  `checks.ts` kept exactly one `SessionCheck` on the session and overwrote it on
  the next run. So the first half of this was building the history:
  `server/utils/checkFlakes.ts` parses a run's output into the individual checks
  that failed and files every verdict per repository in
  `~/.claude/agents-ui/check-history.json` (200 runs, oldest falling off).
  Recorded inside `verifySession`, not at its five call sites, for the reason
  `recordLanded` is filed inside `mergeSession` — a hole in this history is not a
  missing row, it is a check quietly looking more reliable than it is.

- **The definition chosen: passed and failed on an identical workspace.** Not
  the rate. The looser definition does not survive this dataset: six worktrees a
  night run the same suite against six *different* branches, so a check that one
  branch genuinely broke produces fail, pass, fail, pass in the order the runs
  happened, and is indistinguishable from a flake. The fingerprint
  `worktreeFingerprint` already computes for staleness turns that inference into
  a contradiction — same commit, same uncommitted edits, two answers. The rate is
  still what the dialog quotes, because a rate is the readable part; it just is
  not what decides. Cost: nothing is said until a workspace has been checked
  twice, which is the right way round for a sentence somebody reads while
  deciding whether to trust their own suite. `test/checkFlakes.test.ts` has the
  false positive that settled it, as its own test.

- **A failing run that named no checks is dropped, not counted as a pass.** A
  typecheck error or a `make` recipe dying on step one produces a failing run
  with no test names in it, and reading that as "every test passed" would invent
  evidence out of a broken build.

- **Runner coverage is four families**: vitest/jest, pytest, go, cargo. A project
  whose runner is none of those records runs with no names in them and is told
  nothing — silence, which is the brief's rule. Adding a family is one regex and
  one test.

- **Known hole, bounded.** `checks.ts` keeps only the last 6000 characters of
  output, so a run with hundreds of failures loses the names at the top. The only
  cost is a flake taking longer to be recognised; nothing is ever wrongly excused,
  because a name that was never recorded as failing cannot be contradicted.

- **What remains unproven.** The by-hand acceptance line is that the wording
  reads clearly to somebody who has not read this brief. That needs a person: open
  a session whose checks are failing, press Merge, read the block above the
  output. Everything up to the render is mechanised — `test/checkFlakes.test.ts`
  builds a real repository, a real worktree and a check command that genuinely
  alternates on unchanged code, runs it seven times through `verifySession`, and
  asserts what `previewMerge` hands the dialog, including that the gate is
  unmoved.
