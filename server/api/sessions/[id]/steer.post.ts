import { findSession } from '../../../utils/sessions'
import { sendSteered } from '../../../utils/sessionTurn'

/**
 * Say something to the turn that is running, now.
 *
 * The counterpart to `message`, which queues while a session is busy. This one
 * reaches the running query instead — the CLI takes it at its next tool boundary
 * — so a turn heading for the wrong file can be corrected without stopping it
 * and paying again for everything it had already worked out.
 *
 * The reply says which of three things happened: `steered` when it reached the
 * running turn, `runId` alone when nothing was running and it went as an
 * ordinary turn, `queued` when a turn was running but would not take it. The
 * page needs the distinction to say what it did rather than what was asked for.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ input: string }>(event)

  if (!body?.input?.trim()) {
    throw createError({ statusCode: 400, message: 'input is required' })
  }

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const result = await sendSteered(session, body.input)

  return { ...result, sessionId: session.id }
})
