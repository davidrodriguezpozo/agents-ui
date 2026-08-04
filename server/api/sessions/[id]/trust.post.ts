import { findSession, patchSession } from '../../../utils/sessions'
import type { TrustLevel } from '../../../utils/trust'

const LEVELS: TrustLevel[] = ['readonly', 'edits', 'full']

/**
 * Change how much a session is trusted.
 *
 * Takes effect on the next turn rather than the one in flight: the SDK is told
 * once, when a run starts, and quietly changing the rules underneath a run
 * would be worse than waiting.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ trust?: string }>(event)

  if (!LEVELS.includes(body?.trust as TrustLevel)) {
    throw createError({ statusCode: 400, message: `trust must be one of: ${LEVELS.join(', ')}` })
  }

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  return patchSession(id, { trust: body.trust as TrustLevel })
})
