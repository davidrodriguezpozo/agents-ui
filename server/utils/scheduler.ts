import { computeNextRun, markRan, permissionModeFor, scheduleStore, type Schedule } from './schedules'
import { resolveRunOptionsFor } from './runOptions'
import { createRun, type Run } from './runStore'
import { executeRun } from './runner'
import { notify } from './notify'
import { outcomeOf } from './ritualHistory'

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
  let due: Schedule[]

  try {
    // Decide and record inside one locked read-modify-write. Doing this as a
    // read, then a loop, then a bulk write would overwrite whatever `markRan`
    // committed in between — leaving `nextRunAt` in the past and firing the
    // ritual a second time on the next tick.
    due = await scheduleStore.update((schedules) => {
      const firing: Schedule[] = []

      for (const schedule of schedules) {
        if (!schedule.enabled) continue
        if (inFlight.has(schedule.id)) continue

        // First sight of this schedule, or a corrupted record.
        if (!schedule.nextRunAt) {
          schedule.nextRunAt = computeNextRun(schedule.recurrence, new Date(now))
          continue
        }

        if (schedule.nextRunAt > now) continue

        if (now - schedule.nextRunAt > CATCH_UP_WINDOW_MS) {
          // Too stale to be useful — skip to the next occurrence without running.
          schedule.nextRunAt = computeNextRun(schedule.recurrence, new Date(now))
          continue
        }

        // Claim it here, so a second tick cannot pick it up while the run is
        // still being started.
        inFlight.add(schedule.id)
        firing.push({ ...schedule })
      }

      return firing
    })
  } catch (e) {
    console.error('[scheduler] could not read schedules', e)
    return
  }

  for (const schedule of due) void fire(schedule)
}

/**
 * Say how it went.
 *
 * A ritual runs precisely when nobody is watching, so this is the only moment
 * it can report for itself. "Blocked" is called out separately from "failed"
 * because it looks like success everywhere else — the run completed, it just
 * did not do the job.
 */
async function announce(title: string, run: Run): Promise<void> {
  const outcome = outcomeOf(run)

  if (outcome === 'failed') {
    await notify('failed', `${title} failed`, run.error || 'The run ended early.')
  } else if (outcome === 'blocked') {
    const tools = (run.deniedTools ?? []).join(', ') || 'a tool'
    await notify('needsYou', `${title} was blocked`, `It needed ${tools} and stopped. Nothing was applied.`)
  } else if (outcome === 'ok') {
    await notify('finished', title, run.output || 'Finished with nothing to report.')
  }
}

/** Already claimed in `inFlight` by the tick that selected it. */
async function fire(schedule: Schedule): Promise<void> {
  try {
    const options = await resolveRunOptionsFor({
      projectDir: schedule.projectDir,
      agentSlug: schedule.agentSlug,
      // The trust level was chosen when the ritual was created, so a run at 8am
      // doesn't have to ask a question nobody is there to answer.
      permissionMode: permissionModeFor(schedule.permission),
      allowRules: schedule.allowRules,
    })

    const run = createRun({
      kind: 'command',
      title: schedule.title,
      input: schedule.input,
      invocation: schedule.invocation,
      agentSlug: schedule.agentSlug,
      projectDir: options.cwd,
      scheduleId: schedule.id,
    })

    // Advance the schedule before the run finishes, so a long run can't cause
    // a second fire on the next tick.
    await markRan(schedule.id, run.id)

    console.log(`[scheduler] running "${schedule.title}" as ${run.id}`)
    await executeRun(run, options, { unattended: true })
    await announce(schedule.title, run)
  } catch (e) {
    console.error(`[scheduler] "${schedule.title}" failed to start`, e)
  } finally {
    inFlight.delete(schedule.id)
  }
}
