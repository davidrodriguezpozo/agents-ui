import { deliveryNotice, unansweredReasons } from '../../utils/decisions'
import { findSession } from '../../utils/sessions'

/**
 * The decisions still waiting for a reason, batched by session.
 *
 * Batched here rather than in the page, because the batching is the design: a
 * session that took six decisions is one row asking about six, and a queue that
 * grew a row per event is the mistake this app has twice nearly made.
 *
 * Reading also retires whatever has run out of time — see `unansweredReasons`.
 */
export default defineEventHandler(async () => {
  const sessions = await unansweredReasons(async (sessionId) => {
    const session = await findSession(sessionId)
    return session?.title ?? null
  })

  // Delivery's own state, said once and carried here because this is the
  // surface a decision would otherwise have reached a person through. A machine
  // with no Slack set up is not broken; it is a machine whose records stay
  // local, and that is worth saying exactly once. See `decisionDelivery.ts`.
  return { sessions, notice: await deliveryNotice() }
})
