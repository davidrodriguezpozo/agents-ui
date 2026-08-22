import { ledgerWindow, MAX_LEDGER_DAYS } from '../../utils/ledger'
import { joinOutcomes, outcomeTurnOf } from '../../utils/outcomes'
import { collapseChainRuns, outcomeOf } from '../../utils/ritualHistory'
import { ritualValueOf, type RitualValue } from '../../utils/ritualValue'
import { runRecordsSince, summarizeRun, type RunSummary } from '../../utils/runStore'
import { readSchedules } from '../../utils/schedules'
import { readSessions } from '../../utils/sessions'

/**
 * What each ritual has cost and what came of it, keyed by ritual id.
 *
 * Beside `/api/schedules/history` rather than inside it, because the two answer
 * different questions over different sets of records: history is the last ten
 * firings whatever their age, and this is a window of whole days. Folding them
 * together would mean one of the two silently changing meaning.
 *
 * The default window is thirty days. A ritual runs once a morning, so a week
 * gives five firings and no idea whether a fortnight of them was worth
 * anything — and the sentence this exists to make possible is about three
 * weeks, not three days.
 *
 * Not cheap, for the reason `/api/ledger` is not: every run file in the window
 * is opened, with its event log. The page loads it beside the rituals and
 * survives it failing.
 */

const DEFAULT_DAYS = 30

export interface RitualValueReport {
  window: { days: number; since: number; until: number }
  /** Keyed by ritual id, one entry per ritual that exists. */
  rituals: Record<string, RitualValue>
}

export default defineEventHandler(async (event): Promise<RitualValueReport> => {
  const days = Math.max(1, Math.min(Number(getQuery(event).days) || DEFAULT_DAYS, MAX_LEDGER_DAYS))
  const window = ledgerWindow(days, Date.now())

  // The same window shape the ledger uses, so a ritual's row and the ledger's
  // ritual table cannot end up quoting different figures for the same days.
  const [runs, sessions, schedules] = await Promise.all([
    runRecordsSince(window.since),
    readSessions(),
    readSchedules(),
  ])

  const report = joinOutcomes({
    turns: runs.map(outcomeTurnOf),
    sessions,
    since: window.since,
    until: window.until,
  })
  const groups = new Map(report.byRitual.map(group => [group.key, group]))

  /*
   * Firings, not runs. A chained ritual produces a run per step, and counting
   * those would report a three-step chain that failed once as three runs that
   * came to nothing — the same miscount `listRunsBySchedule` exists to avoid on
   * the history side.
   */
  const byRitual = new Map<string, RunSummary[]>()
  for (const run of runs) {
    if (!run.scheduleId) continue
    const bucket = byRitual.get(run.scheduleId) ?? []
    bucket.push(summarizeRun(run))
    byRitual.set(run.scheduleId, bucket)
  }

  const rituals: Record<string, RitualValue> = {}
  // Keyed off the rituals that exist, so runs left behind by a deleted one do
  // not come back as a ghost row — the same reason the history endpoint does it.
  for (const schedule of schedules) {
    // `collapseChainRuns` wants newest first, which is how the run log arrives
    // and the order the bucket above preserves.
    const firings = collapseChainRuns(byRitual.get(schedule.id) ?? [])

    rituals[schedule.id] = ritualValueOf({
      expects: schedule.expects,
      firings: firings.map(firing => ({
        outcome: outcomeOf(firing),
        interrupted: firing.interrupted,
      })),
      group: groups.get(schedule.id),
      days: window.days,
    })
  }

  return {
    window: { days: window.days, since: window.since, until: window.until },
    rituals,
  }
})
