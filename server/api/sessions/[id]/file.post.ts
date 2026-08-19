import { findSession, patchSession } from '../../../utils/sessions'

/**
 * Say whether you are still working on a session.
 *
 * The In flight tab used to derive this, and could not: a session whose turn has
 * finished, whose workspace holds nothing and which has no pull request looks
 * exactly like a session that just answered your question and is waiting for
 * the follow-up. Every automatic signal available says "over"; only one of the
 * two actually is.
 *
 * So it is asked. This is not `DELETE` in a softer coat — the worktree, the
 * branch and the record are all untouched, and the next turn clears it. It moves
 * a row between two tabs, which is why it is safe enough to be one click with no
 * confirmation behind it.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ aside?: boolean }>(event)

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  // Filing an already-filed session must not move the date: it would read as
  // "you finished with this just now" in a list sorted by when things happened.
  const aside = body?.aside !== false
  const filedAt = aside ? session.filedAt ?? Date.now() : undefined

  /**
   * `patchSession` bumps `updatedAt`, and that is wanted here rather than
   * tolerated: taking a session back out of History has to restart the clock
   * that put an untouched empty one there in the first place, or it would drop
   * straight back in on the next poll.
   */
  return patchSession(id, { filedAt })
})
