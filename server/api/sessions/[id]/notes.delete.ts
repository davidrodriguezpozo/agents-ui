import { clearNotes, dropNote } from '../../../utils/diffNotes'
import { findSession } from '../../../utils/sessions'

/**
 * Drop one note, or all of them.
 *
 * `noteId` picks one — you reread the line and changed your mind. Without it the
 * list is emptied, which is both the Discard button and what the page does once
 * the turn carrying the notes has been accepted.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ noteId?: string }>(event).catch(() => ({}) as { noteId?: string })

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const notes = body?.noteId ? await dropNote(id, body.noteId) : await clearNotes(id)
  return { notes }
})
