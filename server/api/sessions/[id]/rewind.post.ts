import { findSession } from '../../../utils/sessions'
import { rewind, type RewindTarget } from '../../../utils/rewind'

/**
 * Put the workspace back — either to the last commit, or one commit further.
 *
 * Destroys work on purpose, which is the point, so it is a POST and goes
 * through the same-origin check in front of every request: a page you happen
 * to have open cannot reach it.
 *
 * The refusal to pass the session's base lives in `rewind` rather than here,
 * so it holds however this is called.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const body = await readBody<{ target?: RewindTarget }>(event)
  if (body?.target !== 'uncommitted' && body?.target !== 'commit') {
    throw createError({ statusCode: 400, message: 'Say what to rewind: uncommitted, or commit.' })
  }

  return rewind(session, body.target)
})
