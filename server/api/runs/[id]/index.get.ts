import { readRun } from '../../../utils/runStore'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const run = await readRun(id)

  if (!run) {
    throw createError({ statusCode: 404, message: `Run not found: ${id}` })
  }

  return run
})
