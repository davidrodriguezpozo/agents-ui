import { readSessions, type Session } from '../../utils/sessions'
import { pendingDrafts, retiredSince } from '../../utils/reviewDraft'
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
 *
 * A closed session is settled here rather than in GitHub's answer. Closing is
 * how you say you are finished with a review, and a session that posted its own
 * review from the chat leaves a pull request that still looks open, unreviewed
 * and unpushed — so the only record of the work being over is the one on this
 * machine. A session whose record was deleted outright counts the same: Close
 * without keeping the branch is what deleted it.
 */

const DAY = 86_400_000

export default defineEventHandler(async (event) => {
  const projectDir = getProjectDir(event)
  const [drafts, sessions] = await Promise.all([pendingDrafts(), readSessions()])

  const byId = new Map(sessions.map(session => [session.id, session]))

  const pairs = drafts.map((draft) => {
    const session = byId.get(draft.sessionId)
    return {
      draft,
      session,
      repoDir: session?.repoDir ?? '',
      sessionClosed: !session || session.status === 'archived',
    }
  })

  const { live, unchecked } = await retireStale(pairs)

  const stillWaiting = new Set(live.map(draft => draft.sessionId))

  const pending = pairs
    .filter((pair): pair is typeof pair & { session: Session } =>
      Boolean(pair.session) && stillWaiting.has(pair.draft.sessionId))
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
      sessionClosed: gone.filter(d => d.retired!.reason === 'session_closed').length,
    },
  }
})
