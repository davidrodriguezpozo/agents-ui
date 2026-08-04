import { findSession } from '../../../utils/sessions'
import { startTurn } from '../../../utils/sessionTurn'

/**
 * Send a turn to a session.
 *
 * Each turn is a fresh detached run pointed at the session's worktree and
 * resumed onto its SDK session, which is how continuity works — the SDK has no
 * long-lived handle of its own. Everything the run subsystem already does
 * (streaming, replay, permissions, persistence) applies unchanged.
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

  return { runId: await startTurn(session, body.input), sessionId: session.id }
})
