# 26 · Rules that learn, as a diff

**Wave** 9 · **Depends on** 25 · **Hot files** a panel + a write path
**Done when** a candidate lesson can be turned into one proposed line for `CLAUDE.md`, a
project rule, or the half of the brief you write — shown as a diff, applied only when accepted.

## Why

The compounding effect the cloud tools claim and cannot give a self-hosting team: because the
rule lands in the repository, one person accepting it improves everybody's agents on the next
pull. It only works if it is auditable, which means a file and a diff, never a hidden memory.

## Build

- One candidate, one proposed line, one destination — and the destination is a choice, shown
  before anything is written.
- The proposal is written by a small model from the *structured* candidate only. It never sees
  prose from outside this machine, and the brief's own rule about outside text holds.
- Accept writes the line and says which file changed. Reject records that it was rejected so
  the same lesson does not come back next week.
- **It can never write on its own.** No setting turns that on. The moment it does, this is the
  feature people disable.

## Acceptance

- `make check` green, with tests for: accept, reject, a candidate whose destination file does
  not exist, a rejected candidate recurring.
- By hand: accept one real lesson and read the resulting diff. If you would not have written
  that line yourself, the prompt is wrong.

## Out of scope

Editing existing rules. Removing rules that have gone stale — its own brief, later.

## Findings

**The model only ever sees the counted facts, and a test asserts it.** The prompt
is built from six fields of the candidate with `JSON.stringify`, so a field added
to `LessonCandidate` later cannot silently widen it. The one string in a lesson
that came from outside this machine — a session title — is proved absent from the
prompt by name. Nothing outside this machine can influence the rule it proposes,
which is the property that makes accepting one reasonable.

**Three destinations, and the choice comes before the line.** `CLAUDE.md` in the
repository is the one that compounds — accept a rule, commit it, and everybody's
agents improve on their next pull. The standing brief is the machine-only
equivalent, for a note nobody else should read. The project's shared
configuration is for recording a decision where the team reviews it. The prompt
differs per destination, because a rule for a repository and a note to one laptop
are not the same sentence — and offering one while writing the other is how a
person stops trusting the diff.

**Accepting writes the line that was shown.** The whole proposal goes back to the
endpoint rather than a key, deliberately: re-deriving the line server-side would
mean a second model call, and then the diff somebody read is not necessarily what
lands. It appends and never reorders, and a destination that does not exist is
created — said out loud in the diff first.

**Both verdicts remove a lesson from the list, for different reasons.** Rejected
was considered and declined, and re-offering it weekly is how a list stops being
read. Accepted already has its rule in a file. The record is kept on this machine
and not in the repository — the *rule* belongs to the team, but "I have already
thought about this" is bookkeeping, and putting that in somebody's diff would be
this app filing paperwork in a code review.

**Nothing can write unattended.** There is no setting, and `acceptProposal` has
exactly one caller: the endpoint behind the accept button.

## The by-hand acceptance, and what it caught

The brief's test is "accept one real lesson and read the diff — if you would not
have written that line yourself, the prompt is wrong." Run against the one real
lesson on this machine (`api.fontsource.org`, refused five times), proposing into
a scratch repository. **The first attempt failed that test, in two ways at once:**

```
"repository": "mt2z09ee5lmu"
Vendor fonts locally or cache api.fontsource.org responses to avoid repeated access denials.
```

1. **The repository was a session id.** The lesson's `repoDir` came from a run,
   and a session's run names its *worktree* — whose last segment is generated.
   The model was told it was writing a rule for a repository called
   `mt2z09ee5lmu`. Fixed with `repositoryRootOf` in `worktrees.ts`, which is now
   also used by `sharedLedger.ts` — the same bug was one push away from
   publishing a session id to a colleague's machine as the name of a repository.
2. **The line blamed the wrong party.** "Access denials" reads as the remote
   refusing us. It did not: our own sandbox blocked the request and nothing ever
   reached fontsource. A rule written on that misreading sends the next person to
   the wrong place entirely — to a caching layer instead of to one line of
   sandbox configuration. The prompt now states what each of the three signals
   means, in this tool's terms.

The second attempt, same lesson, same model:

```
"repository": "agents-ui"
Allow api.fontsource.org in your development tool permissions to build this project.
```

That is the rule, and it is one I would have written — "in the sandbox for this
project" is how I would have phrased it, which is the same instruction. So the
brief's judgement test passes now and demonstrably did not before, which is the
most useful thing this unit produced.

**What remains unproven.** Only the panel's own presses: the endpoints, the
prompt, the model call, the diff and the write were all exercised for real, and
the accept path was run end to end against a scratch repository, but the buttons
themselves were not clicked in a browser. The two model calls this cost were
Haiku with a six-field prompt.
