import { buildLedger, ledgerWindow, MAX_LEDGER_DAYS } from '../utils/ledger'
import { runRecordsSince } from '../utils/runStore'
import { readSchedules } from '../utils/schedules'
import { readSessions } from '../utils/sessions'
import type { SideCost } from '../utils/spend'

export default defineEventHandler(async (event) => {
  const days = Math.max(1, Math.min(Number(getQuery(event).days) || 7, MAX_LEDGER_DAYS))
  const now = Date.now()

  // Worked out here as well as inside `buildLedger` because the run log has to
  // be read from the *earlier* of the two windows, and the load is the reason
  // this endpoint is not cheap.
  const { previousSince } = ledgerWindow(days, now)

  // Run records rather than summaries: `RunSummary` carries neither the model
  // nor the repository nor the events, and the ledger groups by the first two
  // and asks the third whether the turn changed a file.
  const runs = await runRecordsSince(previousSince)
  const sessions = await readSessions()

  // Summaries are model calls that never enter the run log. Kept beside the
  // totals rather than inside them, so "what did the work cost" and "what did
  // the app cost around the work" stay separable.
  const side: SideCost[] = sessions
    .map(session => session.summary)
    .filter((s): s is NonNullable<typeof s> => Boolean(s && s.costUsd > 0 && s.at >= previousSince))
    .map(s => ({ source: 'summary' as const, costUsd: s.costUsd, at: s.at }))

  // A ritual's key is a generated id. Read here rather than looked up in the
  // browser because the Work page does not load the rituals and should not have
  // to for a table of names.
  const ritualTitles = Object.fromEntries(
    (await readSchedules().catch(() => [])).map(schedule => [schedule.id, schedule.title]),
  )

  return buildLedger({ runs, sessions, side, days, now, ritualTitles })
})
