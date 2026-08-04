import { findSession } from '../../../utils/sessions'
import { checkCommandFor } from '../../../utils/checks'
import { verifySession } from '../../../utils/sessionChecks'

/**
 * Run this project's checks in the session's workspace, now.
 *
 * Turns that change files verify themselves, so this is for the times that
 * rule does not cover: a verdict that has gone stale, a suite that was fixed
 * outside the session, or simply wanting to know before deciding.
 *
 * Waits for the answer rather than returning immediately — the caller asked
 * the question, and a check that reports "started" is a check nobody reads.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const resolved = await checkCommandFor(session.repoDir)
  if (!resolved) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'no_check_command',
        message: 'This project has no checks set up. Add the command that tells you whether it works, in Settings.',
      },
    })
  }

  return { check: await verifySession(id) }
})
