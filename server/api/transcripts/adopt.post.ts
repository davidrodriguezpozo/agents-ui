import { getProjectDir } from '../../utils/scope'
import { listTranscripts } from '../../utils/transcripts'
import { startSession } from '../../utils/startSession'

/**
 * Continue a terminal conversation here.
 *
 * The conversation is resumed by id, but the work moves into a worktree of its
 * own — which is the entire point, and also the one thing the conversation
 * does not know. The session is marked adopted so the page can offer to say so
 * before anything else is asked of it.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ sdkSessionId?: string; dir?: string; agentSlug?: string }>(event)
  const dir = body?.dir || getProjectDir(event)

  if (!dir) {
    throw createError({ statusCode: 400, message: 'A project directory is required' })
  }
  if (!body?.sdkSessionId) {
    throw createError({ statusCode: 400, message: 'Which conversation?' })
  }

  // Read the title from the transcript rather than trusting the caller: it is
  // the first thing the person actually said, and it is on disk either way.
  const transcript = (await listTranscripts(dir, 50)).find(t => t.sdkSessionId === body.sdkSessionId)
  if (!transcript) {
    throw createError({
      statusCode: 404,
      data: {
        error: 'no_transcript',
        message: 'That conversation is no longer on disk, so there is nothing to continue.',
      },
    })
  }

  return startSession({
    repoDir: dir,
    title: transcript.title,
    agentSlug: body.agentSlug,
    sdkSessionId: transcript.sdkSessionId,
    adoptedAt: Date.now(),
  })
})
