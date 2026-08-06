import { findSession } from '../../../utils/sessions'
import { startTurn, turnRefusal } from '../../../utils/sessionTurn'
import { beginManualRepair } from '../../../utils/sessionRepair'

/**
 * Have this session go and fix its own failing checks.
 *
 * The same loop the preference turns on, started deliberately for one session.
 * It works with the preference at zero, because pressing a button *is* the
 * decision that preference exists to record — and it starts a fresh streak over
 * one that has already given up, since asking again is asking again.
 *
 * Returns as soon as the first turn is away. What happens after that is the
 * ordinary machinery: the turn runs, the checks run, and a still-failing
 * verdict earns another attempt until they pass or the attempts are spent.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const refusal = turnRefusal(session)
  if (refusal) throw createError({ statusCode: 409, data: refusal })

  const plan = await beginManualRepair(session)
  if ('error' in plan) {
    throw createError({ statusCode: 409, data: plan })
  }

  return {
    runId: await startTurn(session, plan.input, { repair: true }),
    sessionId: session.id,
  }
})
