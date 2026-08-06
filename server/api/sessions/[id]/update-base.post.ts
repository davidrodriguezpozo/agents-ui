import { findSession } from '../../../utils/sessions'
import { updateFromBase } from '../../../utils/worktrees'
import { verifySession } from '../../../utils/sessionChecks'

/**
 * Catch a session up with its base branch, then find out whether it still works.
 *
 * The two halves belong together. Bringing `main` in is only worth doing to
 * learn whether the session's work still holds against it, and a green check
 * from before the base moved is exactly the thing this exists to replace.
 *
 * Waits for the verdict rather than returning as soon as the merge lands: the
 * caller asked whether this session is still good, and half an answer is the
 * stale badge again by another name.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const session = await findSession(id)
  if (!session) throw createError({ statusCode: 404, message: `Session not found: ${id}` })

  const result = await updateFromBase(session.worktreePath, session.baseBranch)

  if (result.status === 'refused') {
    throw createError({ statusCode: 409, data: { error: 'cannot_update', message: result.message } })
  }

  // A conflict leaves the workspace mid-merge, so there is nothing to verify —
  // running the checks there would report a failure about the conflict rather
  // than about the code.
  const check = result.status === 'conflicted' ? null : await verifySession(id)

  return { ...result, check }
})
