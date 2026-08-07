import { deleteSession, findSession } from '../../utils/sessions'
import { deleteBranch, pruneWorktrees, removeWorktree } from '../../utils/worktrees'
import { describeOutcome, verifyEmpty, type EmptyVerdict } from '../../utils/emptySessions'

/**
 * Close several sessions that produced nothing.
 *
 * Every one is checked again here rather than taken on the browser's word.
 * The page may be minutes old, this deletes branches, and "it had nothing in
 * it when I last looked" is not good enough for that.
 *
 * Never forces. `removeWorktree` refuses a worktree with uncommitted work, and
 * that refusal is the last line — if a session gained changes between the
 * check above and the removal below, it survives.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: unknown }>(event)
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : []

  if (!ids.length) {
    throw createError({ statusCode: 400, data: { error: 'no_sessions', message: 'Nothing to close.' } })
  }

  const closed: string[] = []
  const skipped: EmptyVerdict[] = []

  for (const id of ids) {
    const session = await findSession(id)
    if (!session) continue

    const verdict = await verifyEmpty(session)
    if (!verdict.empty) {
      skipped.push(verdict)
      continue
    }

    try {
      await removeWorktree(session.repoDir, session.worktreePath, { force: false })
      await pruneWorktrees(session.repoDir)
      await deleteBranch(session.repoDir, session.branch)
      await deleteSession(id)
      closed.push(id)
    } catch {
      // Git said no — almost certainly work that appeared in the last second.
      // Left exactly as it was.
      skipped.push({ id, title: session.title, empty: false, reason: 'has-changes' })
    }
  }

  return { closed, skipped, message: describeOutcome(closed.length, skipped) }
})
