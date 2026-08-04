import { listRunsBySchedule } from '../../utils/runStore'
import { summarizeRitualRuns, type RitualHistory } from '../../utils/ritualHistory'
import { readSchedules } from '../../utils/schedules'

/**
 * What every ritual has actually been doing, keyed by ritual id.
 *
 * One request for the whole page: the run files have to be read as a set
 * anyway, and a failing ritual is only noticeable if its history is on screen
 * without being asked for.
 */
export default defineEventHandler(async (event): Promise<Record<string, RitualHistory>> => {
  const limit = Math.max(1, Math.min(Number(getQuery(event).limit ?? 10), 50))

  const [schedules, grouped] = await Promise.all([
    readSchedules(),
    listRunsBySchedule(limit),
  ])

  const histories: Record<string, RitualHistory> = {}
  // Keyed off the rituals that exist, so runs left behind by a deleted one
  // don't come back as a ghost row.
  for (const schedule of schedules) {
    histories[schedule.id] = summarizeRitualRuns(grouped[schedule.id] ?? [])
  }

  return histories
})
