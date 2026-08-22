# 18 · The shared ledger

**Wave** 7 · **Depends on** 11, 17 · **Hot files** new util + a push/pull path
**Done when** each instance appends its outcomes to a file it owns, those files can be
pushed to and read from a branch nobody reviews, and the ledger page can show team totals.

## Why

This is the only piece of the team plane that carries data between machines, so it is the
piece that decides whether the architecture stays local-first. Append-only, one file per
instance, git as the transport: no server, no accounts, and an instance that is offline for
a week is not a failure state.

## Build

- One file per machine, named by machine, append-only, one line per outcome — spend, landing,
  revert, check verdict, person, timestamp. Never rewrite a line.
- Push and pull are explicit and boring: commit to a dedicated branch, force nothing, and
  merge by concatenation because appends to distinct files never conflict.
- Reading team totals is reading every file present. A missing machine is a missing machine,
  and the page says how fresh each one is rather than averaging over a gap.
- **No prose in the ledger.** Ids, numbers, routes, timestamps. It must be safe to read into
  a page and it must never become an attack surface via a session title someone else wrote.

## Acceptance

- `make check` green, with tests for: append idempotence, two machines, a corrupt line
  (skipped and counted), a file from a newer version of the format.
- By hand: two checkouts on one machine, pointed at different `CLAUDE_DIR`s, produce one total.

## Out of scope

Real-time anything. Seeing another machine's in-flight sessions.

## Findings

**`ledger.ts` was already taken, by unit 12.** That file is cost-per-accepted-merge
over two windows of *this* machine's join, and this is a different population
entirely: one appended line per outcome, from every machine that has pushed. So
this is `sharedLedger.ts` (format, append, totals), `ledgerSync.ts` (git),
`ledgerCollect.ts` (the one part that reads the local stores), and a
`TeamLedger.vue` section under the existing one rather than inside it. The two
are deliberately never added together or reconciled on the page — they will not
tie exactly, and a single figure made of both would be the arithmetic nobody can
reproduce, which is the failure `ledger.ts` was written to avoid.

**The transport touches no working tree, and that decided the implementation.**
The obvious way to write a file to a branch is to check the branch out, which in
this app would mean doing it in a repository where somebody has a session
mid-edit. So the push is plumbing: `hash-object -w` for the blob, `read-tree`
into a throwaway `GIT_INDEX_FILE`, `update-index --cacheinfo`, `write-tree`,
`commit-tree`, then `push <commit>:refs/heads/<branch>`. The pull is `ls-tree`
plus `cat-file blob` straight into the store. `HEAD`, the checked-out branch and
`git status` are asserted unchanged across a push in `test/ledgerSync.test.ts`.

**Nothing forces, and it does not need to.** Each instance writes only the file
it owns, so a colleague's push and ours differ in different blobs: rebuilding on
their tip is the concatenation the brief asks for. A rejected push is retried
once on the new tip and then left for the next sync — the lines are already safe
locally, so there is never a reason to insist.

**A machine id is per instance, not per host.** Two checkouts on one laptop
pointed at different `CLAUDE_DIR`s are two writers, and a hostname-only filename
would have them clobbering each other — which is exactly the acceptance case.
The id is `<hostname-slug>-<6 hex>`, written once into `ledger/machine` and read
after that, so moving a store keeps its file rather than orphaning it.

**A newer format is not a corrupt line.** A colleague who updates first pushes
lines this reader has never seen, and the only honest answers are to count them
and say so. `corrupt` and `newer` are separate per-machine counts, both surfaced
in the page's footnote. Both are also copied through untouched by an append: the
lines belong to whoever wrote them.

**The window has to apply to sessions, not only to the run log.**
`readSessions` is not windowed, so without a filter the first collect would
write a line for every landing this machine has ever made. Collection re-reads
30 days every time rather than keeping a high-water mark — a second piece of
state that can disagree with the file it describes — and relies on the entry ids
making a repeat free.

**The sync endpoint checks the path against registered projects.** It is the one
place here that runs git in a directory a browser named. An unregistered path is
refused rather than added, because adding a project is a decision that belongs on
the projects page. `test/ledgerSyncEndpoint.test.ts` exists for that check alone.

**Syncing is a press, not a timer.** The brief asked for push and pull to be
explicit and boring, so reading is local and offline and nothing fetches on
mount. Putting it on the scheduler is a separate decision — it needs a repository
chosen once and stored, and a view on what happens when that repository is gone
— and was left out rather than half-made.

**What was verified by hand, and what was not.** The brief's by-hand acceptance —
two stores, one machine, one total — is mechanised in `test/ledgerSync.test.ts`
against a bare repository and two clones, which is the same thing without the
typing. Beyond that, and beyond `make check`: a dev server on a chosen port with
`CLAUDE_DIR` pointed at a throwaway store, seeded with two machine files
including a corrupt line and a line from a future format. `GET /api/ledger/team`
returned the totals, and the Ledger tab rendered them — two machines with their
own freshness, both people, `$4.00` unattributed, and both skip counts in the
footnote. Two copy faults were found that way and fixed: a plural disagreement in
the newer-lines sentence, and an empty repository picker beside an enabled button
on a store with no projects.

What remains unproven is the network: every push and pull here has been against a
local path, so authentication, a slow remote and a real rejection race are
untested. `POST /api/ledger/sync` has been exercised against a repository with no
remote and against unregistered paths, not against one with a live origin.
