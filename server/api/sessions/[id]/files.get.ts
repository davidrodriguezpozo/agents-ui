import { findSession } from '../../../utils/sessions'
import { listDirectory } from '../../../utils/workspaceFiles'

/**
 * One directory of a session's workspace.
 *
 * A level at a time rather than the whole tree: a worktree walked in one go is
 * a large response that is mostly dependencies, and the tree people open is one
 * level at a time anyway.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const path = (getQuery(event).path as string) || ''
  return { path, entries: await listDirectory(session.worktreePath, path) }
})
