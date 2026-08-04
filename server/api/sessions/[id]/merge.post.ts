import { findSession, patchSession } from '../../../utils/sessions'
import { commitSessionWork, mergeSession } from '../../../utils/merge'

/**
 * Merge a session's branch into the branch it came from.
 *
 * `commitFirst` sweeps up anything the agent left uncommitted — without it that
 * work stays behind in the worktree, which is rarely what someone means by
 * "merge this".
 *
 * `override` proceeds over a failing check, and only over a failing check —
 * everything git objects to still stops here.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ message?: string; commitFirst?: boolean; override?: boolean }>(event)

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  let committed = 0
  if (body?.commitFirst) {
    committed = await commitSessionWork(session, `${session.title} (uncommitted work)`)
  }

  // Re-read: committing the leftovers changed the branch this is about to
  // merge, and the preview inside `mergeSession` should see that.
  const ready = committed ? await findSession(id) ?? session : session

  const result = await mergeSession(ready, { message: body?.message, override: body?.override })
  await patchSession(id, { updatedAt: Date.now() })

  return { ...result, committedBeforeMerge: committed }
})
