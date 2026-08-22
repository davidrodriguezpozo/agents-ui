# 17 · Who did this

**Wave** 6 · **Depends on** 11 · **Hot files** run and session records, merge path
**Done when** every run and every merge records a person, and the ledger can group by them.

## Why

The moment more than one person runs this, "who merged with checks red" and "whose rituals
cost that" become the two questions worth answering. The merge commit already records an
override; nothing records who took it.

## Build

- Identity is git's: `user.name` and `user.email` from the repository, resolved once per run
  and stored on the record. **No accounts, no login, no new store for people.**
- Stamp: who started a run, who sent each turn, who merged, who took *Merge anyway*.
- Existing records have no person. They must read as **unattributed**, never as you.
- Extend brief 11's util with a per-person grouping, and add one line to the ledger page.

## Acceptance

- `make check` green, with tests for: a record with no identity, a repository with no git
  identity configured, two identities on one session.
- By hand: the merge dialog's override note names the person in the commit message.

## Out of scope

Permissions, roles, or anything that gates an action on who you are. GitHub does that.

## Findings

- **`git var GIT_COMMITTER_IDENT` cannot be used, and that is the whole design.**
  It always answers: with `user.name` unset git invents one from the login and the
  hostname, so a repository that names nobody would have produced a plausible
  person — `davidrodriguezpozo@Davids-MacBook.local` — filed against merges they
  never took. `gitIdentity` reads `git config --get user.name` and `user.email`
  instead, and a repository resolving neither answers `undefined`. It is the
  *resolved* value, not `--local`: one `~/.gitconfig` and no per-repository
  identity is the ordinary setup, and reading local-only would call most people's
  repositories unattributed. Testing the negative therefore needs
  `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` pointed at files that do not exist —
  see `withoutInheritedConfig` in `test/identity.test.ts`, without which the test
  passes or fails depending on whose laptop runs it.
- **Where the stamp lands, and where it deliberately does not.** `startSession`
  (`Session.startedBy`), `startTurn` and `POST /api/runs` (`Run.by`),
  `mergeSession` and the pull-request watcher (`SessionLanded.by`). Nothing is
  stamped on: a ritual, which the scheduler builds directly and which nobody
  sent; and a landing whose `how` is `elsewhere`, because that merge happened on
  github.com and naming the local identity would file a colleague's merge under
  whoever's machine noticed. Both read as unattributed, which is what every
  record written before this reads as too — the whole of the migration.
- **Repair turns are stamped, and that was a decision.** `startTurn` marks turns
  the app decided to send (`{ repair: true }`), and leaving those unattributed
  would split one session's cost between a person and nobody depending on which
  turns the app chose to take. A repair turn is this app finishing the job
  somebody asked for; a ritual is not, and a ritual does not come through
  `startTurn`.
- **A person's key is their email, lower-cased; the name is a label.** People
  rewrite `user.name`, and two colleagues sharing a name would be one row in a
  table of money. A repository with only a name configured keys on the name,
  which is a worse key and better than dropping the work. The name shown beside
  it is read back off the run log by `personNames` in `ledger.ts` — no store of
  people exists, because whoever sent a turn wrote their name onto it at the time.
- **A person's *merges* are the merges of the sessions they last worked on, not
  the merges they pressed the button for.** The same rule every other dimension
  in `joinOutcomes` uses. Attributing landings by `landed.by` instead would
  produce a group with one merge and no spend — `$0.00 per merge` — for anybody
  who merged a session they had not worked on in the window, and would break the
  property that a group's spend and its merges describe the same work. Who
  actually took a merge is on the record and in the merge commit, which is where
  that question is asked.
- **Unit 09's files were not touched at all.** `server/utils/issues.ts` and
  `server/api/github/issues/work.post.ts` needed no edit: they cut sessions
  through `startSession`, which is where the stamp lives, so every route into a
  session — typed in, adopted from the terminal, started off an issue or a Notion
  ticket — gets it without any of them knowing.
- **Not stamped, and worth a line: workflow runs.** `workflowRunner.ts` builds
  its runs directly, like the scheduler, but unlike the scheduler a workflow can
  be started by a person pressing a button *or* fired by a ritual — and the
  runner cannot currently tell which. Left unattributed rather than guessed. It
  would take a `by` threaded from whichever caller starts the run, which is a
  change to that module's shape rather than a stamp, and is not this brief.
- **The by-hand acceptance line is mechanised, not simulated.**
  `test/identity.test.ts` builds a real repository and worktree, records a
  failing check, calls the real `mergeSession(session, { override: true })`, and
  reads `git log -1 --format=%B` back off `main`. It asserts the commit carries
  *Override taken by Ada Lovelace &lt;Ada@Example.com&gt;* and that the same
  person is filed on `session.landed.by`. What remains unproven is only the
  click: that the merge dialog's **Merge anyway** button posts `override: true`.
  `sessions/[id]/merge.post.ts` passes that straight through, and everything
  after it is under test. Somebody with a browser has to press it once.
- **`RunSummary` was left alone**, per unit 11's finding about six surfaces
  reading it. The ledger already reads whole run records through
  `runRecordsSince`, which carries `by` for free. Nothing renders
  `Session.startedBy` yet either — it is on the record for unit 18's shared
  ledger and unit 19's team digest to read.
