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
