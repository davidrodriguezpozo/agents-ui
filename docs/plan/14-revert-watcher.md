# 14 · When landed work gets reverted

**Wave** 3 · **Depends on** 11 · **Hot files** new watcher util + session record
**Done when** a revert of a commit this machine landed is recorded against the session, the
agent and the model, and shows on the session and in the ledger.

## Why

"It merged" is not the same as "it was right". A revert is the cheapest honest signal of
work that should not have landed, and it is available locally for free — nobody else records
the merge, so nobody else can notice the undo.

## Build

- Read `server/utils/landed.ts` and whichever poller already watches the base branch
  (`prWatch.ts` / `landing.ts` — find out which, and reuse it; do not add a second loop).
- Detect a revert of a landed commit: `git log` on the base branch for a commit whose message
  reverts a recorded SHA, or whose diff is the inverse. Start with the message, which is what
  `git revert` writes, and say in the comment that the inverse-diff case is not covered.
- Record: when, by whom if git knows, and which session it undoes. Show it on the session
  row and count it in the ledger as work that did not hold.
- A revert is not a failure of the app. The wording must not read as blame.

## Acceptance

- `make check` green, with tests over a fixture repository: a revert, a revert of a revert,
  a commit merely mentioning the word.
- By hand: revert something small in a scratch repo and watch the row change.

## Out of scope

Doing anything about it — reopening, re-running, notifying. Recording is the whole brief.
