import { setDecisionReason } from '../../utils/decisions'

/**
 * Say why, on one decision.
 *
 * One line, and deliberately nothing else: no severity, no category, no form.
 * The whole bet of this queue is that it costs five seconds, and every field
 * added to it is a reason to close the row instead of answering it.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ reason?: string }>(event)

  if (typeof body?.reason !== 'string' || !body.reason.trim()) {
    throw createError({ statusCode: 400, message: 'reason must be a sentence' })
  }

  const decision = await setDecisionReason(id, body.reason)

  // Not an error. The record may have been answered in another tab, or the
  // store reset under it, and a failure on a row that has already done its job
  // is a worse answer than nothing happening.
  return { saved: Boolean(decision), decision }
})
