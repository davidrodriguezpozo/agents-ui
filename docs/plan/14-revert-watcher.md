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

## Findings

- **Nothing watched the base branch, so there was no loop to reuse.** The brief
  names `prWatch.ts` / `landing.ts`; neither is a poller of the base branch.
  `prWatchRunner.pollPullRequests` asks GitHub about *pull requests*, and
  `landing.ts` is pure planning with no loop at all. What does exist is the
  scheduler's two-minute `pollTimer`, which `tickInbox`, `tickDigestDelivery`,
  `tickDigestCommands` and `refreshBrief` all ride. `pollReverts` rides the same
  one and guards itself per repository, the way `tickInbox` does — so this is a
  two-line diff in `scheduler.ts` and no second timer.
- **A landing had no commit to be reverted, so `SessionLanded` gained `sha`.**
  This is the part the brief did not have to name and could not have worked
  without: "a revert of a commit this machine landed" needs the commit. Written
  by `mergeSession` (`rev-parse HEAD` after the `--no-ff` merge) and by the pull
  request watcher, which needed `mergeCommit` added to `readPrStatus` — and one
  extra `gh` call on the single poll where a pull request lands, because the
  status read while it was open has no merge commit in it yet. **Every landing
  recorded before this is invisible to the watcher**, permanently, and that is
  the right trade: back-filling would mean guessing which commit was theirs.
- **The inverse-diff case is not covered**, as the brief allows. Only the message
  `git revert` writes is read. Two further gaps worth stating: the watcher reads
  the *local* base branch and never fetches, so a pull request merged on
  github.com is not asked about until somebody pulls; and a base branch that gets
  rebased loses the sha and with it the thread.
- **A revert of a revert clears the record rather than being ignored.** It has to:
  a one-way flag would mark a session for good on the first mistaken revert, and
  the correction is the more common half of that pair. Clearing is guarded on the
  recorded revert being inside the log window actually read — otherwise a short
  read would erase real records.
- **The ledger counts reverts as of now, in both windows.** `revertedLandings`
  sits beside `landings` rather than inside it: the four route counts are one
  partition adding to the total, and this one cuts across them. It is deliberately
  not paired into a change figure, because the earlier window has had longer for
  its merges to be reverted — the page says so. Spend still counts a reverted
  merge as a merge, because it was one.
- **The by-hand step could not be done through the server.** `node .output/server`
  cannot bind a socket in this worktree — port 3000 and an unused 3199 both come
  back `EADDRINUSE`, which matches the recorded finding about `nuxt dev` here. Done
  instead by driving the real `pollReverts` against a scratch repository with a
  real `git revert` in it, and printing both the record and the badge the row
  renders from it: `Landed, then reverted`, then cleared when the revert was
  itself reverted. The same path is `test/revertWatch.test.ts`.
