import { listSnapshots, snapshotsDir } from '../../utils/snapshots'
import { readSchedules } from '../../utils/schedules'
import { readSessions } from '../../utils/sessions'

/**
 * What is backed up right now, and what state it would be protecting.
 *
 * Reading the live stores here is deliberate: if one of them is damaged, this
 * endpoint is where the user finds that out, next to the button that fixes it.
 */
export default defineEventHandler(async () => {
  const snapshots = await listSnapshots()

  let live: { sessions: number; schedules: number } | null = null
  let problem: string | null = null

  try {
    const [sessions, schedules] = await Promise.all([readSessions(), readSchedules()])
    live = { sessions: sessions.length, schedules: schedules.length }
  } catch (e) {
    problem = (e as Error).message
  }

  return {
    directory: snapshotsDir(),
    snapshots,
    live,
    problem,
  }
})
