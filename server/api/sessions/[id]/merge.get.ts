import { findSession } from '../../../utils/sessions'
import { previewMerge } from '../../../utils/merge'

/** What would happen, checked before anything is written. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  return previewMerge(session)
})
