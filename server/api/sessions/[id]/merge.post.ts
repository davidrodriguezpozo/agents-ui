import { findSession, patchSession } from '../../../utils/sessions'
import { commitSessionWork, mergeRefusal, mergeSession } from '../../../utils/merge'

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

  /*
   * Asked before anything is written, because `commitFirst` writes to whatever
   * the worktree is on. `mergeSession` refuses both of these on its own, but by
   * then the leftovers would already be a commit — in a review workspace, a
   * commit on a colleague's pull request branch.
   */
  const refusal = await mergeRefusal(session)
  if (refusal) {
    throw createError({
      statusCode: 409,
      data: { error: 'merge_blocked', message: refusal.reason },
    })
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
