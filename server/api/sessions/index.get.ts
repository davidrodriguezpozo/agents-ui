import { readSessions } from '../../utils/sessions'
import { worktreeStatus } from '../../utils/worktrees'

/**
 * Sessions with the live state of their worktree, not just what we recorded.
 * A worktree deleted outside the app should show up as gone here rather than
 * being reported as healthy.
 */
export default defineEventHandler(async () => {
  const sessions = await readSessions()

  return Promise.all(sessions.map(async (session) => {
    const status = await worktreeStatus(session.worktreePath, session.baseSha || session.baseBranch)
    return { ...session, worktree: status }
  }))
})
