import { computeNextRun, markRan, permissionModeFor, readSchedules, writeSchedules, type Schedule } from './schedules'
import { resolveRunOptionsFor } from './runOptions'
import { createRun } from './runStore'
import { executeRun } from './runner'

const TICK_MS = 30_000

/**
 * How late a missed run may still fire. A laptop asleep overnight shouldn't
 * dump yesterday's 8am briefing on you at 3pm — but opening the lid at 08:20
 * should still give you this morning's.
 */
const CATCH_UP_WINDOW_MS = 2 * 60 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null
/** Schedules with a run currently in flight, so a slow run can't stack up. */
const inFlight = new Set<string>()

export function startScheduler(): void {
  if (timer) return

  // A first pass shortly after boot catches anything due while we were down.
  setTimeout(() => void tick(), 5_000)
  timer = setInterval(() => void tick(), TICK_MS)
  console.log('[scheduler] started')
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export async function tick(now = Date.now()): Promise<void> {
  let schedules: Schedule[]
  try {
    schedules = await readSchedules()
  } catch (e) {
    console.error('[scheduler] could not read schedules', e)
    return
  }

  if (!schedules.length) return

  let mutated = false

  for (const schedule of schedules) {
    if (!schedule.enabled) continue
    if (inFlight.has(schedule.id)) continue

    // First sight of this schedule, or a corrupted record.
    if (!schedule.nextRunAt) {
      schedule.nextRunAt = computeNextRun(schedule.recurrence, new Date(now))
      mutated = true
      continue
    }

    if (schedule.nextRunAt > now) continue

    const lateBy = now - schedule.nextRunAt
    if (lateBy > CATCH_UP_WINDOW_MS) {
      // Too stale to be useful — skip to the next occurrence without running.
      schedule.nextRunAt = computeNextRun(schedule.recurrence, new Date(now))
      mutated = true
      continue
    }

    void fire(schedule)
  }

  if (mutated) {
    try {
      await writeSchedules(schedules)
    } catch (e) {
      console.error('[scheduler] could not persist schedule times', e)
    }
  }
}

async function fire(schedule: Schedule): Promise<void> {
  inFlight.add(schedule.id)

  try {
    const options = await resolveRunOptionsFor({
      projectDir: schedule.projectDir,
      agentSlug: schedule.agentSlug,
      // The trust level was chosen when the ritual was created, so a run at 8am
      // doesn't have to ask a question nobody is there to answer.
      permissionMode: permissionModeFor(schedule.permission),
    })

    const run = createRun({
      kind: 'command',
      title: schedule.title,
      input: schedule.input,
      invocation: schedule.invocation,
      agentSlug: schedule.agentSlug,
      projectDir: options.cwd,
    })

    // Advance the schedule before the run finishes, so a long run can't cause
    // a second fire on the next tick.
    await markRan(schedule.id, run.id)

    console.log(`[scheduler] running "${schedule.title}" as ${run.id}`)
    await executeRun(run, options, { unattended: true })
  } catch (e) {
    console.error(`[scheduler] "${schedule.title}" failed to start`, e)
  } finally {
    inFlight.delete(schedule.id)
  }
}
