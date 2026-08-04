import { findSession } from '../../../utils/sessions'
import { readTranscriptMessages } from '../../../utils/transcripts'

/**
 * The conversation an adopted session is continuing.
 *
 * Read from Claude Code's own transcript rather than from anything this app
 * recorded, because the conversation happened in a terminal. It is history:
 * nothing here is editable, and new turns are recorded the ordinary way.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  if (!session.sdkSessionId) return { messages: [] }

  return {
    messages: await readTranscriptMessages(session.repoDir, session.sdkSessionId),
  }
})
