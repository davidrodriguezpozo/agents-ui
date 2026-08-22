import { notesFor } from '../../../utils/diffNotes'
import { findSession } from '../../../utils/sessions'

/**
 * The notes written on this session's diff and not yet sent.
 *
 * Read on opening the page, so the reload that interrupted you halfway down a
 * long diff does not cost you the four notes you had already written.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  return { notes: await notesFor(id) }
})
