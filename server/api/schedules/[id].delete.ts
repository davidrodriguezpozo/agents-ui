import { deleteSchedule } from '../../utils/schedules'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const deleted = await deleteSchedule(id)

  if (!deleted) {
    throw createError({ statusCode: 404, message: `Schedule not found: ${id}` })
  }

  return { deleted: true, id }
})
