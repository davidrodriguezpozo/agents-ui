import { findSession } from '../../../utils/sessions'
import { previewRewind } from '../../../utils/rewind'

/**
 * What a rewind would throw away, named before anything happens.
 *
 * "Discard 3 files" is a number somebody has to take on trust; the filenames
 * are something they can check against what they remember doing.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  return previewRewind(session)
})
