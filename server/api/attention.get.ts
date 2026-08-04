import { readSessions } from '../utils/sessions'
import { listPending } from '../utils/permissionBroker'
import { getActive, listRunsBySchedule, readRun, type RunSummary } from '../utils/runStore'
import { summarizeRitualRuns } from '../utils/ritualHistory'
import { readSchedules } from '../utils/schedules'

/**
 * What, if anything, wants you.
 *
 * One small endpoint the whole app can poll, so the sidebar can say "one needs
 * you" rather than "six agents exist". Counting how much you own is not a
 * reason to look at a page; being blocked is.
 */
export default defineEventHandler(async () => {
  const [sessions, schedules, ritualRuns] = await Promise.all([
    readSessions().catch(() => []),
    readSchedules().catch(() => []),
    listRunsBySchedule(10).catch(() => ({} as Record<string, RunSummary[]>)),
  ])

  let blocked = 0
  let working = 0

  for (const session of sessions) {
    if (session.status === 'archived') continue

    const lastRunId = session.runIds.at(-1)
    if (!lastRunId) continue

    if (listPending(lastRunId).length) {
      blocked++
      continue
    }

    const run = getActive(lastRunId)?.run ?? await readRun(lastRunId)
    if (run?.status === 'running' || run?.status === 'queued') working++
  }

  // A ritual that has come to nothing several times running is asking for
  // attention just as much as a prompt is — it is simply less loud about it.
  const failingRituals = schedules.filter(schedule =>
    schedule.enabled && summarizeRitualRuns(ritualRuns[schedule.id] ?? []).failingStreak >= 2
  ).length

  return {
    /** Sessions stopped on a permission prompt. */
    blocked,
    /** Sessions with a turn in flight. */
    working,
    failingRituals,
    /** Everything that will not move until you do something. */
    needsYou: blocked + failingRituals,
  }
})
