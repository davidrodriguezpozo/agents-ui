import { findSession } from '../../../utils/sessions'
import { clearQueue, dropQueuedMessage } from '../../../utils/sessionQueue'

/**
 * Drop a waiting message, or all of them.
 *
 * Nothing else can: once a message is queued it belongs to the session rather
 * than the tab it was typed in, so changing your mind has to be a request like
 * sending was. `messageId` picks one; without it the queue is emptied.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ messageId?: string }>(event).catch(() => ({}) as { messageId?: string })

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const updated = body?.messageId
    ? await dropQueuedMessage(id, body.messageId)
    : await clearQueue(id)

  return { queued: updated?.queued ?? [] }
})
