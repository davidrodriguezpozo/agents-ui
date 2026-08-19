import { deleteSession, findSession, patchSession } from '../../../utils/sessions'
import { deleteBranch, pruneWorktrees, removeWorktree } from '../../../utils/worktrees'

/**
 * Close a session and clean up after it.
 *
 * Refuses by default when the worktree has uncommitted work — losing an
 * agent's output to a stray click is the worst thing this could do. `?force=1`
 * is the deliberate override, and `?keepBranch=1` keeps the branch so the work
 * survives even though the worktree is gone.
 *
 * A borrowed branch is never deleted, whatever was asked. `-D` on somebody's
 * pull request branch, or on a branch you had here before any of this, destroys
 * work that was never this session's to destroy — and the session that reads
 * as emptiest is exactly the one most likely to have borrowed rather than made
 * its branch.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const query = getQuery(event)
  const force = query.force === '1' || query.force === 'true'
  const keepBranch = query.keepBranch === '1' || query.keepBranch === 'true'

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  await removeWorktree(session.repoDir, session.worktreePath, { force })
  await pruneWorktrees(session.repoDir)

  const ours = !session.borrowedBranch
  if (!keepBranch && ours) {
    await deleteBranch(session.repoDir, session.branch)
  }

  // Keeping the branch means keeping the record, so there is a trail back to it.
  if (keepBranch) {
    await patchSession(id, { status: 'archived', worktreeRemovedAt: Date.now() })
  } else {
    await deleteSession(id)
  }

  return { closed: true, id, branchKept: keepBranch || !ours ? session.branch : null }
})
