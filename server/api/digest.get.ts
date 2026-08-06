import { buildDigest, DEFAULT_WINDOW_MS } from '../utils/digest'
import { findSession } from '../utils/sessions'
import { worktreeStatus } from '../utils/worktrees'

/**
 * What happened while you were away.
 *
 * `since` defaults to the last day, which is the window the pitch is about.
 * Pass one to ask about a longer absence.
 */
export default defineEventHandler(async (event) => {
  const asked = Number(getQuery(event).since)
  const since = Number.isFinite(asked) && asked > 0 ? asked : Date.now() - DEFAULT_WINDOW_MS

  const digest = await buildDigest(since)

  // Git is asked here rather than in the builder, and only about the sessions
  // that actually moved — a repository call per session is fine for a handful
  // and would not be for all of them.
  digest.sessions = await Promise.all(digest.sessions.map(async (entry) => {
    const session = await findSession(entry.id)
    if (!session) return entry

    const status = await worktreeStatus(
      session.worktreePath,
      session.baseSha || session.baseBranch,
      session.baseBranch,
    ).catch(() => null)

    return { ...entry, behindBase: (status?.behind ?? 0) > 0 }
  }))

  return digest
})
