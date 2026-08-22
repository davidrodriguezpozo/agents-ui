import { addNote } from '../../../utils/diffNotes'
import { findSession } from '../../../utils/sessions'

/**
 * Keep one note on one line.
 *
 * The id and the timestamp are the server's, not the page's — the id is what
 * removing a note is addressed to, and a page that made its own would be able to
 * collide with a note written in another tab.
 *
 * Answers with the whole list rather than the note, because that is what the
 * page draws.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ file?: string; line?: number; snippet?: string; body?: string }>(event)

  if (!body?.file || !body?.body?.trim()) {
    throw createError({ statusCode: 400, message: 'file and body are required' })
  }

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const notes = await addNote(id, {
    file: body.file,
    line: Number(body.line ?? 0),
    snippet: body.snippet ?? '',
    body: body.body,
  })

  return { notes }
})
