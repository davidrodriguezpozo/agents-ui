import { cancel, readRun } from '../../../utils/runStore'
import { releaseRunningSession } from '../../../utils/sessions'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const run = await readRun(id)
  if (!run) {
    throw createError({ statusCode: 404, message: `Run not found: ${id}` })
  }

  const cancelled = cancel(id)

  // A stopped turn leaves its session marked `running` until the SDK unwinds,
  // which is after the browser has already been told the run is over.
  if (cancelled && run.sessionId) await releaseRunningSession(run.sessionId)

  return { cancelled, status: cancelled ? 'cancelled' : run.status }
})
