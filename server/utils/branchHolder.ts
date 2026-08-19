import { readSessions, type Session } from './sessions'
import { canonicalPath, listWorktrees, looksLikeSessionWorktree, pruneWorktrees, worktreeRootFor } from './worktrees'

/**
 * Who has this branch, and what to do about it.
 *
 * "fatal: branch X is already checked out at Y" is git telling the truth and
 * the app repeating it as though it were the end of the conversation. It is
 * not: the reason you are here is that you want to work on that branch, and
 * something on this machine already has a workspace with exactly that branch in
 * it. The useful answer is that workspace, not an error.
 *
 * Four situations wear the same git message, and they want four different
 * things — which is why this is a verdict rather than a boolean:
 *
 *   - Nothing has it. Cut a workspace, as always.
 *   - A session of yours has it and is idle. That *is* the session for this
 *     branch. Continue it rather than making a second one; a second session on
 *     the same branch is not possible anyway, which is how we got here.
 *   - A session of yours has it and is working. Say so and offer to open it.
 *     Interrupting a running agent to send it something else is a decision, and
 *     it belongs to the person, not to a click on a pull request row.
 *   - A directory of ours has it and no session claims it — a record deleted
 *     out from under a worktree, a crash, a recovery half-done. Take the
 *     directory over. This is the case where reusing the directory is exactly
 *     right, and it is the one people mean when they say "just reuse it".
 *   - Your own checkout has it: you have the branch out in the repository
 *     itself. Nothing here may touch that. It is your working copy, possibly
 *     with your uncommitted work in it, and the only person who can decide to
 *     switch it away is you.
 */
export type BranchHolder =
  | { kind: 'free' }
  /** A session of ours, idle: continue it. */
  | { kind: 'session'; session: Session }
  /** A session of ours, mid-turn: offer it, do not touch it. */
  | { kind: 'busy'; session: Session }
  /** One of our directories with no session behind it: take it over. */
  | { kind: 'adoptable'; path: string }
  /** Your own checkout, or a worktree somebody else set up. Hands off. */
  | { kind: 'foreign'; path: string }

export interface HolderInput {
  /** Where this app puts its worktrees — `<repo>/.worktrees`. */
  worktreeRoot: string
  /** The worktree git says holds the branch, with its path resolved. */
  holder: { path: string; canonical: string } | null
  /** The session whose workspace is that directory, when there is one. */
  session: Session | null
}

/**
 * The judgement, separated from the git and the store so it can be tested for
 * what it actually is: a decision about someone else's work.
 */
export function holderVerdict({ worktreeRoot, holder, session }: HolderInput): BranchHolder {
  if (!holder) return { kind: 'free' }

  if (session) {
    // An archived session has had its worktree removed, so it cannot be the
    // holder of anything — if a record says otherwise the directory is what to
    // believe, and it is ours to take back.
    if (session.status === 'archived') return { kind: 'adoptable', path: holder.path }
    return session.status === 'running'
      ? { kind: 'busy', session }
      : { kind: 'session', session }
  }

  return looksLikeSessionWorktree(worktreeRoot, { canonical: holder.canonical })
    ? { kind: 'adoptable', path: holder.path }
    : { kind: 'foreign', path: holder.path }
}

/**
 * Ask git which worktree holds a branch, and the store whose session that is.
 *
 * A worktree git still records but whose directory is gone is pruned first
 * rather than reported: it holds the branch only in git's bookkeeping, and the
 * honest answer after pruning is that the branch is free.
 */
export async function findBranchHolder(repoDir: string, branch: string): Promise<BranchHolder> {
  if (!branch) return { kind: 'free' }

  let worktrees = await listWorktrees(repoDir)
  let holding = worktrees.find(w => w.branch === branch)

  if (holding?.prunable) {
    await pruneWorktrees(repoDir)
    worktrees = await listWorktrees(repoDir)
    holding = worktrees.find(w => w.branch === branch)
  }

  if (!holding) return { kind: 'free' }

  // Both sides resolved, for the reason `canonicalPath` exists: git reports
  // paths with symlinks already followed, and on a machine where /tmp or a home
  // directory is a symlink a session fails to match its own workspace.
  const canonical = await canonicalPath(holding.path)
  const sessions = await readSessions()
  const owners = await Promise.all(
    sessions.map(async s => ({ session: s, canonical: await canonicalPath(s.worktreePath) })),
  )

  return holderVerdict({
    worktreeRoot: await canonicalPath(worktreeRootFor(repoDir)),
    holder: { path: holding.path, canonical },
    session: owners.find(o => o.canonical === canonical)?.session ?? null,
  })
}
