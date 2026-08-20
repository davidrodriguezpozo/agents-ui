import { readSessions } from '../../utils/sessions'
import { pendingDrafts } from '../../utils/reviewDraft'
import { getProjectDir } from '../../utils/scope'

/**
 * Reviews composed on this machine and not yet sent.
 *
 * The rollup that makes the composer visible from outside the session it lives
 * in. A review sitting in a workspace nobody opens is the same failure the
 * session summary was written for: work that got done and then waited for
 * somebody to remember it existed.
 *
 * Read from the draft store alone — no git, no GitHub — so Land can ask on every
 * poll without it costing anything.
 */
export default defineEventHandler(async (event) => {
  const projectDir = getProjectDir(event)
  const [drafts, sessions] = await Promise.all([pendingDrafts(), readSessions()])

  const byId = new Map(sessions.map(session => [session.id, session]))

  const pending = drafts
    .map((draft) => {
      const session = byId.get(draft.sessionId)
      if (!session) return null

      return {
        sessionId: draft.sessionId,
        pr: draft.pr,
        title: session.title,
        repoDir: session.repoDir,
        comments: draft.findings.filter(f => f.include).length,
        blocking: draft.findings.filter(f => f.include && f.severity === 'BLOCKING').length,
        event: draft.event,
        composedAt: draft.composedAt,
        // Everything is returned so a review waiting in another project still
        // says so, the way sessions already do.
        inCurrentProject: !projectDir || session.repoDir === projectDir,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b!.composedAt - a!.composedAt)

  return { pending }
})
