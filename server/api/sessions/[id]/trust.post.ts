import { findSession, patchSession } from '../../../utils/sessions'
import type { TrustLevel } from '../../../utils/trust'

const LEVELS: TrustLevel[] = ['readonly', 'edits', 'full']

/**
 * Change how much a session is trusted.
 *
 * Takes effect immediately when the change is to Auto, including on a turn
 * already running: the permission callback re-reads this record on every tool
 * call, so a prompt that has not been answered yet is answered by the level you
 * just chose. See `liveTrust.ts` — pressing Auto and then being asked again was
 * the control lying about its own state.
 *
 * The other direction still waits for the next turn, and cannot do otherwise: a
 * run already told `bypassPermissions` never asks, so there is no request left
 * to intercept and nothing to tighten.
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
