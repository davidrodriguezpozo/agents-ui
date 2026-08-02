import { listSessions } from '../../../utils/history'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, message: 'slug is required' })

  const limit = Number(getQuery(event).limit) || 50
  return listSessions(slug, limit)
})
