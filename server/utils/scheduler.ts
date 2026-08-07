import {
  computeNextRun, markRan, pauseRitual, permissionModeFor, scheduleStore, skipToNextRun,
  type Schedule,
} from './schedules'
import { resolveRunOptionsFor } from './runOptions'
import { createRun, listRunsBySchedule, type Run } from './runStore'
import { executeRun } from './runner'
import { notify } from './notify'
import { outcomeOf, summarizeRitualRuns, type RitualHistory } from './ritualHistory'
import { RETRY_DELAY_MS, shouldGiveUp, shouldRetry } from './ritualHealth'
import { checkBudget } from './budget'
import { describeIncomplete } from './digest'
import { withRunSlot } from './runQueue'

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
    // Same outcome, two quite different mornings. Told apart here because the
    // notification is often the only account of it anybody reads.
    const headline = run.stoppedBy ? `${title} ran out` : `${title} was blocked`
    await notify('needsYou', headline, describeIncomplete(run))
  } else if (outcome === 'ok') {
    await notify('finished', title, run.output || 'Finished with nothing to report.')
  }
}

/** How this ritual's recent runs stand. Empty history on any trouble reading. */
async function historyFor(scheduleId: string): Promise<RitualHistory> {
  try {
    const bySchedule = await listRunsBySchedule()
    return summarizeRitualRuns(bySchedule[scheduleId] ?? [])
  } catch {
    return { runs: [], failingStreak: 0 }
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Already claimed in `inFlight` by the tick that selected it. */
async function fire(schedule: Schedule): Promise<void> {
  try {
    // The case the daily limit exists for: work that spends money at 08:00
    // with nobody watching. Skipped without starting, and said out loud —
    // a ritual that silently stopped running would be worse than the bill.
    const budget = await checkBudget(Date.now(), { unattended: true })
    if (!budget.allowed) {
      console.log(`[scheduler] skipping "${schedule.title}": ${budget.reason}`)
      await skipToNextRun(schedule.id)
      await notify('failed', `${schedule.title} was skipped`, budget.reason!)
      return
    }

    // Where this ritual stood *before* today's attempt. It decides whether a
    // failure is a bad morning or the latest in a run of them, so it has to be
    // read before the run that is about to join it.
    const before = await historyFor(schedule.id)

    const run = await runOnce(schedule, budget.maxBudgetUsd)
    await announce(schedule.title, run)

    // One more go at a failure that might not repeat. Nobody is awake to press
    // the button, and losing the morning to a dropped connection is a poor
    // reason to have no briefing.
    if (shouldRetry(outcomeOf(run), before)) {
      console.log(`[scheduler] "${schedule.title}" failed — retrying once in ${Math.round(RETRY_DELAY_MS / 60_000)} min`)

      // Waited out while still holding this ritual's claim, so no tick can fire
      // it underneath us. A restart during the wait loses the retry, which is
      // the right way round: the next occurrence is never far away.
      await sleep(RETRY_DELAY_MS)

      // Re-checked rather than reused: ten minutes have passed, and the rest of
      // the machine has been spending money throughout them.
      const retryBudget = await checkBudget(Date.now(), { unattended: true })
      if (retryBudget.allowed) {
        const again = await runOnce(schedule, retryBudget.maxBudgetUsd)
        await announce(schedule.title, again)
      }
    }

    // With the attempt on disk, ask the question the history was always for:
    // has this stopped working? Stopping is the useful answer — it ends the
    // waste, and it is the only way the next failure reaches anybody instead
    // of joining a queue of identical ones nobody reads.
    const verdict = shouldGiveUp(await historyFor(schedule.id))
    if (verdict) {
      await pauseRitual(schedule.id, verdict.reason)
      await notify('needsYou', `${schedule.title} has been turned off`, verdict.reason)
    }
  } catch (e) {
    console.error(`[scheduler] "${schedule.title}" failed to start`, e)
  } finally {
    inFlight.delete(schedule.id)
  }
}

/** One attempt, start to finish, recorded against the ritual. */
async function runOnce(schedule: Schedule, maxBudgetUsd: number | undefined): Promise<Run> {
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
  // Queued: several rituals falling due in the same minute is the normal case,
  // not the exception.
  await withRunSlot(() => executeRun(run, options, { unattended: true, maxBudgetUsd }))
  return run
}
