import { cancel, readRun } from '../../../utils/runStore'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const run = await readRun(id)
  if (!run) {
    throw createError({ statusCode: 404, message: `Run not found: ${id}` })
  }

  const cancelled = cancel(id)
  return { cancelled, status: cancelled ? 'cancelled' : run.status }
})
