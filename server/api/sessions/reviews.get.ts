import { readSessions, type Session } from '../../utils/sessions'
import { pendingDrafts, retiredSince, type ReviewDraft } from '../../utils/reviewDraft'
import { retireStale } from '../../utils/reviewRetire'
import { getProjectDir } from '../../utils/scope'

/**
 * Reviews composed on this machine and not yet sent.
 *
 * The rollup that makes the composer visible from outside the session it lives
 * in. A review sitting in a workspace nobody opens is the same failure the
 * session summary was written for: work that got done and then waited for
 * somebody to remember it existed.
 *
 * It used to read the draft store alone — no git, no GitHub — which was cheap
 * and, after a few weeks of use, wrong. The store only knows about reviews *this
 * app* sent, so every one posted from a browser tab or from `gh` stayed on the
 * list for good, alongside pull requests that had since merged and drafts
 * anchored to commits three pushes back. So it asks GitHub too, and retires what
 * it learns about — see `reviewRetire` for why that stays affordable, and for
 * the rule that an unreachable GitHub retires nothing.
 */

const DAY = 86_400_000

export default defineEventHandler(async (event) => {
  const projectDir = getProjectDir(event)
  const [drafts, sessions] = await Promise.all([pendingDrafts(), readSessions()])

  const byId = new Map(sessions.map(session => [session.id, session]))

  // A draft whose session is gone has no repository to ask about and nothing to
  // link to, which is the same reason it was already left off the list.
  const known = drafts
    .map(draft => ({ draft, session: byId.get(draft.sessionId) }))
    .filter((pair): pair is { draft: ReviewDraft; session: Session } => Boolean(pair.session))

  const { live, unchecked } = await retireStale(
    known.map(({ draft, session }) => ({ draft, repoDir: session.repoDir })),
  )

  const stillWaiting = new Set(live.map(draft => draft.sessionId))

  const pending = known
    .filter(({ draft }) => stillWaiting.has(draft.sessionId))
    .map(({ draft, session }) => ({
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
    }))
    .sort((a, b) => b.composedAt - a.composedAt)

  // Counted from the store rather than from this pass, so the sentence survives
  // the next poll. A row that disappears with no explanation is the same doubt
  // as a row that should have disappeared and did not.
  const gone = await retiredSince(Date.now() - DAY)

  return {
    pending,
    /** Left on the list because GitHub could not be asked about them. */
    unchecked,
    retired: {
      alreadyReviewed: gone.filter(d => d.retired!.reason === 'already_reviewed').length,
      prClosed: gone.filter(d => d.retired!.reason === 'pr_closed').length,
      headMoved: gone.filter(d => d.retired!.reason === 'head_moved').length,
    },
  }
})
