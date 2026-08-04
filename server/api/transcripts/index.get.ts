import { getProjectDir } from '../../utils/scope'
import { listTranscripts } from '../../utils/transcripts'
import { readSessions } from '../../utils/sessions'

/**
 * Terminal conversations in this project that could be continued here.
 *
 * Ones already adopted are dropped rather than shown as done: offering to
 * adopt the same conversation twice would produce two worktrees resuming the
 * same history, which is a race nobody asked for.
 */
export default defineEventHandler(async (event) => {
  const dir = (getQuery(event).dir as string) || getProjectDir(event)
  if (!dir) return { dir: null, transcripts: [] }

  const [transcripts, sessions] = await Promise.all([
    listTranscripts(dir),
    readSessions().catch(() => []),
  ])

  const taken = new Set(sessions.map(s => s.sdkSessionId).filter(Boolean))

  return {
    dir,
    transcripts: transcripts.filter(t => !taken.has(t.sdkSessionId)),
  }
})
