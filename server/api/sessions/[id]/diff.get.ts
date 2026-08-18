import { findSession } from '../../../utils/sessions'
import { diffBase, worktreeDiff } from '../../../utils/worktrees'

/** Everything the session changed, committed or not, against where it branched. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  return worktreeDiff(session.worktreePath, await diffBase(session))
})
