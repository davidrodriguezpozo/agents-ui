import { findSession } from '../../../utils/sessions'
import { flushQueue } from '../../../utils/sessionTurn'

/**
 * Send what is waiting, now.
 *
 * The queue drains itself when a turn finishes, so this is for the two endings
 * where it deliberately does not: a turn you stopped by hand, and a turn that
 * failed. Whatever was queued behind either is still there, and this is the
 * button that says yes, send it anyway.
 *
 * Returns the run it started, or null when there was nothing to send — a queue
 * emptied by a turn ending a moment earlier is not an error, it is the thing
 * having already happened.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  return { runId: await flushQueue(id) }
})
