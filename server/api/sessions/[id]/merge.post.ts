import { findSession, patchSession } from '../../../utils/sessions'
import { commitSessionWork, mergeSession } from '../../../utils/merge'

/**
 * Merge a session's branch into the branch it came from.
 *
 * `commitFirst` sweeps up anything the agent left uncommitted — without it that
 * work stays behind in the worktree, which is rarely what someone means by
 * "merge this".
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ message?: string; commitFirst?: boolean }>(event)

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  let committed = 0
  if (body?.commitFirst) {
    committed = await commitSessionWork(session, `${session.title} (uncommitted work)`)
  }

  const result = await mergeSession(session, { message: body?.message })
  await patchSession(id, { updatedAt: Date.now() })

  return { ...result, committedBeforeMerge: committed }
})
