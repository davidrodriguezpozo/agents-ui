import { collectLessons } from '../../utils/lessons'
import { destinationsFor, proposeLine, type ProposalDestination } from '../../utils/lessonProposals'
import { runRecordsSince } from '../../utils/runStore'
import { readSessions } from '../../utils/sessions'
import { checkHistoryStore, type CheckHistory } from '../../utils/checkFlakes'
import { getProjectDir } from '../../utils/scope'

/**
 * Ask for one line, for one lesson, for one destination.
 *
 * Its own press because it is the only part that costs anything, and because the
 * destination has to be chosen before a line exists — a proposal written for
 * `CLAUDE.md` is a different sentence from a note to this machine, and offering
 * one and writing the other is how a person stops trusting the diff.
 *
 * Writes nothing. What comes back is a line and the diff accepting it would make.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ key?: string; destination?: ProposalDestination; dir?: string }>(event)
    .catch(() => ({} as { key?: string; destination?: ProposalDestination; dir?: string }))

  const repoDir = body?.dir || getProjectDir(event)
  if (!repoDir) throw createError({ statusCode: 400, message: 'Pick a project first.' })
  if (!body?.key) throw createError({ statusCode: 400, message: 'Which lesson?' })

  const into = destinationsFor(repoDir).find(candidate => candidate.destination === body.destination)
  if (!into) throw createError({ statusCode: 400, message: 'Say where the line should go.' })

  const now = Date.now()
  const [runs, sessions, checks] = await Promise.all([
    runRecordsSince(now - 30 * 86_400_000).catch(() => []),
    readSessions().catch(() => []),
    checkHistoryStore.read().catch((): CheckHistory => ({})),
  ])

  const candidate = collectLessons({
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
  }).find(found => found.key === body.key)

  if (!candidate) {
    throw createError({
      statusCode: 404,
      data: { error: 'gone', message: 'That lesson is no longer in the list — it may have aged out.' },
    })
  }

  return proposeLine(candidate, into)
})
