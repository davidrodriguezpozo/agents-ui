# 16 · Mine and ours

**Wave** 7 · **Depends on** nothing · **Hot files** rituals, checks and sandbox stores
**Done when** a ritual, a check command and a sandbox rule can each be marked as belonging
to the repository rather than to this machine, and the repository half arrives by pulling.

## Why

Rituals, checks and sandbox rules are already files. What is missing is the distinction
between *mine* and *ours*: without it a shared ritual cannot arrive by pulling `main`, and a
personal experiment cannot avoid landing in somebody's review. This is the whole of the team
plane's configuration story, and it needs no server.

## Build

- Read `server/utils/schedules.ts`, `checks.ts`, `sandbox.ts` and `projectRules.ts`.
- Repository-scoped definitions live under the project's `.claude/` directory in a documented
  file. Machine-scoped ones stay where they are.
- Precedence is one rule, stated once and tested: repository provides the default, machine
  overrides it, and the UI always says which one is in force and where it came from.
- Editing a shared thing from the app writes to the repository file — a change a person
  reviews and commits, never something applied silently.
- A shared ritual that names a path only one machine has must fail legibly on the others.

## Acceptance

- `make check` green, with tests for precedence, for a shared definition that is invalid, and
  for a machine override being removed.
- By hand: commit a shared ritual, pull it in a second checkout, see it listed as shared.

## Out of scope

Syncing anything over a network. Per-person overrides of somebody else's ritual.

## Findings

**The three files this touches all argue against themselves, and they were
right.** `projectRules.ts`, `checks.ts` and `sandbox.ts` each carry the same
paragraph: not in the project's `.claude/settings.json`, because that file is
tracked and one person's convenience must not become the team's policy by way of
a commit nobody asked for. That reasoning is about *implicit* writes, so it is
untouched here — those three files still hold this machine's answers, and nothing
writes the shared half as a side effect of anything. Sharing is a button, it
writes a file in the working tree, and it reaches anybody else when a person
commits it.

**One file, not four.** `<repo>/.claude/agents-studio.json`, holding `checks`,
`sandbox` and `rituals`, documented in the README under *Mine and ours*. One file
because it is read as a diff by whoever reviews the commit, and three files
would make "what does this project share" a question with three answers.

**Precedence is machine, then repository, then default — stated once in
`scoped()` and tested there.** The repository providing the default was the
brief's instruction and it is also the only safe direction: the other way round,
a colleague's commit could change what your machine runs and what it is allowed
to reach, which is exactly what the three files above were protecting. Going over
to the team's answer is deleting your override, which every one of the three
surfaces now offers as *Reset to what this repository shares*.

**A deliberate empty value has to beat a shared one.** `""` is how a project says
it has no checks, and it must not fall through to the shared command. `scoped`
distinguishes absent from empty, and there is a test for exactly that line.

**Two safety decisions that the brief did not ask for and the feature needs.** A
shared ritual arrives **switched off**, with `pausedReason` saying why — a `git
pull` that starts running something at 08:00 is a side effect of a pull, which
this app is not allowed to be. And `permission` is deliberately **not a shared
field**: a definition somebody else committed starts at `readonly` here, because
trust is a fact about a machine and raising it is a local decision. Both are
tested.

**Sharing copies what this machine has chosen, never what the request says.** The
endpoint reads the local store rather than a body field, and refuses to share a
*detected* command — a guess written into a tracked file reads as a decision
somebody made. It also refuses a path that is not a registered project, the same
check `/api/ledger/sync` makes for the same reason.

**A shared ritual is identified by a key, and its state stays local.** Machine
ids mean nothing on another disk, so the file carries a slug (`nightly-brief`)
derived from the title. `syncSharedRituals` refreshes the definition from the
file on every read of the ritual list and never touches `enabled`, `lastRunAt`,
`permission` or the trigger cursor — sharing a ritual shares the intent, not the
history. A ritual removed from the file takes its row with it; a ritual
*unshared* from the app keeps its row and becomes this machine's own again,
because "stop sharing" must not read as "delete".

**An invalid entry is reported, never dropped.** A typo in a colleague's file,
two rituals with one key, a `requires` path pointing outside the repository, a
file from a newer version — each becomes a problem with a path into the file and
a sentence about what would fix it, surfaced in Settings under the file's name.
A ritual that names a path this checkout does not have is a different case and is
said in a different place: it is listed, and the sentence is on its own row on
the rituals page, because that is where somebody wondering why it never fires
looks.

**Unknown fields survive a write.** Somebody on a newer version will have written
keys this code has never heard of, and dropping them on the next write would make
an upgrade look like data loss in their diff.

**What is verified, and how.** `make check` green. Beyond it: a dev server on a
chosen port with `CLAUDE_DIR` pointed at a throwaway store and a scratch
repository sharing a check command, a sandbox rule and three rituals — one good,
one needing a script that is not there, one with no title. Both shared rituals
arrived by reading the file, off, `readonly`, with the reason on the row; the
missing-script one carried its own sentence; the no-title one was reported as
`rituals[2].title`; Settings said "this repository shares a check command, in
.claude/agents-studio.json" and "On, because this repository says so", and listed
both problems.

**Not done, and deliberately.** The brief's by-hand acceptance — commit a shared
ritual, pull it in a second checkout — was verified as far as *reading a file a
second checkout would have*: the git half of it is `git pull`, which is not this
app's code. Permission grants (`projectRules.ts`) are **not** shareable: the
brief named rituals, checks and sandbox rules, and a shared allowlist of what a
run may do without asking is a bigger decision than the other three — it is the
one where "the repository provides the default" has teeth. Left out rather than
half-made.
