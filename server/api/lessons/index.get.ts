import { collectLessons } from '../../utils/lessons'
import { destinationsFor, readLessonDecisions, undecidedLessons } from '../../utils/lessonProposals'
import { outcomeTurnOf } from '../../utils/outcomes'
import { runRecordsSince } from '../../utils/runStore'
import { readSessions } from '../../utils/sessions'
import { checkHistoryStore, type CheckHistory } from '../../utils/checkFlakes'
import { getProjectDir } from '../../utils/scope'

/**
 * What has gone wrong more than once, and nothing else.
 *
 * Reading this list costs nothing: it is `collectLessons` over records this
 * machine already has, with everything anybody has already ruled on removed.
 * Proposing a line is a separate press because that one spends money — see
 * `propose.post.ts`.
 */
export default defineEventHandler(async (event) => {
  const now = Date.now()
  const since = now - 30 * 86_400_000
  const repoDir = (getQuery(event).dir as string) || getProjectDir(event)

  const [runs, sessions, checks, decisions] = await Promise.all([
    runRecordsSince(since).catch(() => []),
    readSessions().catch(() => []),
    checkHistoryStore.read().catch((): CheckHistory => ({})),
    readLessonDecisions(),
  ])

  const candidates = collectLessons({
    now,
    sessions: sessions.map(session => ({
      id: session.id,
      title: session.title,
      repoDir: session.repoDir,
      landed: session.landed ? { at: session.landed.at } : undefined,
      reverted: session.reverted
        ? { at: session.reverted.at, committedAt: session.reverted.committedAt, subject: session.reverted.subject }
        : undefined,
    })),
    runs: runs.map(run => ({
      id: run.id,
      at: run.startedAt ?? run.createdAt,
      sessionId: run.sessionId,
      projectDir: run.projectDir,
      deniedTools: run.deniedTools,
      refusedHosts: run.refusedHosts,
    })),
    checks,
  })

  return {
    lessons: undecidedLessons(candidates, decisions),
    /** Every lesson ruled on, so a page can say what was accepted and where. */
    decided: Object.values(decisions).sort((a, b) => b.at - a.at),
    destinations: repoDir ? destinationsFor(repoDir) : [],
    repoDir: repoDir ?? null,
  }
})
