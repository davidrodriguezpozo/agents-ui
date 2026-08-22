# 24 · Bring the base in, for all of them

**Wave** 8 · **Depends on** 23 · **Hot files** `server/utils/gitOps.ts`, merge/land paths
**Done when** merging a session offers to bring the new base into every other session behind
it, and a conflict it cannot resolve becomes a session with the conflict in its prompt.

## Why

The Graphite move, scoped to sessions this machine owns. It is also the one place an agent is
unambiguously the right tool: a conflict is a small, well-specified, verifiable task, and the
worktree it belongs in already exists.

## Build

- Read `server/utils/gitOps.ts`, `merge.ts` and `worktrees.ts`. Every precondition checked
  before anything is written, aborted rather than left half-applied — the standard this
  repository already holds itself to.
- After a successful merge, offer it. Never automatic, never silent.
- Per session: attempt, and on success re-check. On conflict, leave the worktree exactly as it
  was and start a turn in that session naming the files and the base.
- A session mid-turn is skipped and says so. Never touch a branch another checkout holds.

## Acceptance

- `make check` green, with tests over fixture repositories for: clean rebase, conflict, a
  session mid-turn, a session whose branch is checked out elsewhere.
- By hand: two sessions, merge one, watch the other come forward.

## Out of scope

Resolving conflicts in code yourself. Force-pushing anything, ever.

## Findings

**A merge, not a rebase — and `updateFromBase` already existed.** The brief is
titled auto-rebase and the operation underneath it is `git merge`, which is what
this repository already chose and says why: rebasing rewrites commits somebody
may have pushed or opened a pull request from, and a merge commit in a branch
that exists to be merged costs nothing. Nothing here changed that. What was
missing was never the per-session operation — it was the *pass*, and the fact
that doing it meant remembering to press the same button on five session pages
in the right order.

**"Leave the worktree exactly as it was" is read as "leave the repository
consistent", not "abort the merge".** A conflicted merge is left in the workspace
on purpose, which is what `updateFromBase` already did and says why: the session
needs both sides in front of it, and a merge this app aborted is a conflict
nobody can resolve. Aborting and *then* asking a session to resolve it would be
asking it to reconstruct the conflict first. What the brief's standard does apply
to is everything around that — every precondition is checked before anything is
written, and a session that fails one is skipped with a sentence rather than
half-attempted.

**A real bug, found by the fixtures and not by reasoning: symlinked paths made
every session look held elsewhere.** `git worktree list` resolves paths and a
session record holds what it was given, so on macOS — where the temporary
directory and often the home directory are symlinks — a session's *own* worktree
compared unequal to itself. The guard then fired on every session in the
repository and the pass skipped all of them, with a reason that read like a
sensible safety refusal. Both sides are canonicalised now, and the test asserts
the ordinary case (own worktree, own branch, allowed) before the guarded one.

**git will not let two worktrees hold one branch, so the guard's real case is
narrower than it sounds.** The reachable state is a session whose own workspace
has moved off its branch — `gh pr checkout` inside it — while something else has
taken the branch. That is what the test builds, because a test that tried the
obvious thing simply gets git's own refusal instead.

**Two of the four operations are injected, and that is a test decision.**
Starting a turn spawns an agent and re-checking runs a project's whole suite.
`SweepHooks` is the seam; the real hooks are the default and the fixture tests
pass fakes for those two while letting the merge and the conflict detection hit
real git. The assertions then read the fakes to prove the pass asked for the
right thing — which files were named in the conflict prompt, which session was
re-checked, which was not.

**Sequential, not parallel.** A conflict starts a turn, and five turns in five
worktrees at once is five agents competing for the machine at the moment somebody
is waiting to see whether a merge worked.

**The offer counts only what it can actually do.** `planSweep` is what both the
offer and the run use, so "bring main into 3" is three sessions that will be
attempted — a session mid-turn, one with uncommitted work or one whose branch is
held elsewhere is never in the number, and is listed underneath with its reason
instead.

**Verified, and how.** `make check` green, with the brief's four cases over real
repositories: clean update, conflict, a held branch, and — through the pure plan,
which is where the decision lives — a session mid-turn. Then by hand, against a
dev server on a chosen port with `CLAUDE_DIR` pointed at a throwaway store: a
scratch repository, two sessions each a commit ahead, `main` moved on. The offer
said `updating: 2`, the press answered "2 brought forward", and the moved file
was really in both worktrees afterwards. The Land page drew "2 sessions are
behind main" with the button. No agent was spawned at any point, because nothing
conflicted.

**Not verified against a real agent.** The conflict path's last step — the turn
that actually resolves it — is covered by fixtures with the hook injected, and
was deliberately not run for real: it spawns a Claude session and spends money in
a scratch repository. What is unproven is therefore one thing: whether an agent
handed `conflictPrompt` reliably resolves and commits the merge. Everything up to
handing it over is proven.
