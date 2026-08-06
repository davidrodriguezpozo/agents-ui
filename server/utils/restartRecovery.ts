/**
 * Picking up what a restart dropped.
 *
 * A ritual that fires advances its own clock before the run finishes, so that
 * a slow run cannot be started twice. That is right while the process lives
 * and wrong the moment it doesn't: a deploy, a crash or a closed lid at 03:00
 * leaves the run marked failed and the clock already pointing at tomorrow.
 * The briefing you asked for every morning simply does not happen, and the
 * only trace is one red line in Activity that you find at lunchtime.
 *
 * So on the way back up, a ritual whose run was interrupted has its clock put
 * back to the occurrence it lost, and the scheduler's first pass — five
 * seconds after boot — fires it properly.
 *
 * Two things stop this becoming a loop. The occurrence has to still be recent
 * enough to be worth having, by the same rule the scheduler uses for a laptop
 * that was asleep; and an interrupted run is recorded as a failure like any
 * other, so a ritual that dies on every boot is turned off by the usual
 * give-up rule rather than retried forever.
 */

import { scheduleStore } from './schedules'

/**
 * How stale an occurrence may be and still be worth recovering.
 *
 * Deliberately just inside the scheduler's own two-hour catch-up window. A
 * clock rewound to the very edge of that window would be a few seconds past it
 * by the time the first tick arrives, and the recovery would silently do
 * nothing — the worst possible outcome, since it looks like it worked.
 */
export const RESUME_WINDOW_MS = 115 * 60 * 1000

export interface Resumable {
  scheduleId: string
  /** When the lost run started, which is the occurrence it was firing for. */
  occurredAt: number
}

/**
 * The time to put a ritual's clock back to, or null to leave it where it is.
 *
 * Never moves a clock forward, and never moves one that is already due sooner
 * than the occurrence being recovered — a ritual that runs every five minutes
 * has nothing to recover, because the next one is already closer than the one
 * that was lost.
 */
export function resumeAt(
  schedule: { enabled: boolean; nextRunAt?: number },
  occurredAt: number,
  now: number,
): number | null {
  // A ritual turned off since — possibly turned off *because* it kept dying —
  // is not something to quietly start up again.
  if (!schedule.enabled) return null

  if (now - occurredAt > RESUME_WINDOW_MS) return null
  if (schedule.nextRunAt !== undefined && schedule.nextRunAt <= occurredAt) return null

  return occurredAt
}

/**
 * Which rituals to rewind, given everything a restart interrupted.
 *
 * One entry per ritual even if several of its runs were caught: they were all
 * firing for the same thing, and the earliest is the one worth having back.
 */
export function planResume(
  schedules: { id: string; enabled: boolean; nextRunAt?: number }[],
  interrupted: Resumable[],
  now: number,
): { id: string; nextRunAt: number }[] {
  const earliest = new Map<string, number>()
  for (const run of interrupted) {
    const seen = earliest.get(run.scheduleId)
    if (seen === undefined || run.occurredAt < seen) earliest.set(run.scheduleId, run.occurredAt)
  }

  const plan: { id: string; nextRunAt: number }[] = []
  for (const schedule of schedules) {
    const occurredAt = earliest.get(schedule.id)
    if (occurredAt === undefined) continue

    const at = resumeAt(schedule, occurredAt, now)
    if (at !== null) plan.push({ id: schedule.id, nextRunAt: at })
  }

  return plan
}

/**
 * Put back the clocks of every ritual a restart interrupted, and say which.
 *
 * Decided and written inside one locked update, for the same reason the
 * scheduler's tick is: a read, then a decision, then a write would race the
 * first pass, which is only five seconds away.
 */
export async function resumeInterruptedRituals(
  closed: { scheduleId?: string; createdAt: number }[],
  now = Date.now(),
): Promise<string[]> {
  const rituals: Resumable[] = closed
    .filter(run => run.scheduleId)
    .map(run => ({ scheduleId: run.scheduleId!, occurredAt: run.createdAt }))

  if (!rituals.length) return []

  const resumed = await scheduleStore.update((schedules) => {
    const titles: string[] = []

    for (const { id, nextRunAt } of planResume(schedules, rituals, now)) {
      const schedule = schedules.find(s => s.id === id)
      if (!schedule) continue
      schedule.nextRunAt = nextRunAt
      titles.push(schedule.title)
    }

    return titles
  })

  for (const title of resumed) {
    console.log(`[startup] "${title}" was interrupted — it will run again shortly`)
  }

  return resumed
}
