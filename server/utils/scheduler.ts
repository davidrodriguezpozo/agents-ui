import {
  computeNextRun, markRan, pauseRitual, permissionModeFor, scheduleStore, setEventGap,
  setTriggerCursor, skipToNextRun, type Schedule,
} from './schedules'
import { hasGap, pollTrigger, promptFor, selectNew, titleFor, type TriggerEvent } from './eventTriggers'
import { chainPrompt, shouldContinue, stepTitleFor } from './ritualChain'
import { resolveRunOptionsFor } from './runOptions'
import { createRun, listRunsBySchedule, type Run } from './runStore'
import { executeRun } from './runner'
import { notify } from './notify'
import { outcomeOf, summarizeRitualRuns, type RitualHistory } from './ritualHistory'
import { RETRY_DELAY_MS, shouldGiveUp, shouldRetry } from './ritualHealth'
import { checkBudget } from './budget'
import { describeIncomplete } from './digest'
import { tickInbox } from './inboxTick'
import { tickDigestDelivery } from './digestSend'
import { tickDigestCommands } from './digestCommands'
import { refreshBrief } from './brief'
import { withRunSlot } from './runQueue'
import { pollPullRequests } from './prWatchRunner'

const TICK_MS = 30_000

/** How often triggered rituals ask GitHub what has happened. */
const POLL_MS = 2 * 60_000

/**
 * How late a missed run may still fire. A laptop asleep overnight shouldn't
 * dump yesterday's 8am briefing on you at 3pm — but opening the lid at 08:20
 * should still give you this morning's.
 */
const CATCH_UP_WINDOW_MS = 2 * 60 * 60 * 1000

export type DueVerdict = 'wait' | 'fire' | 'late' | 'missed'

/**
 * What to do about an occurrence, given the time now.
 *
 * Pulled out of the tick because it is the one decision here worth testing on
 * its own: firing it inside a test starts a real agent, and the boundary
 * between "a little late" and "gone" is exactly what wants checking.
 *
 * `catchUp` is what turns the far side of that boundary from `missed` into
 * `late`. The window itself does not move — an occurrence inside it is simply
 * on time, and one outside it is not, whatever the ritual has asked for. What
 * changes is whether being past it means running anyway or not running at all.
 */
export function dueVerdict(
  nextRunAt: number | undefined,
  now: number,
  catchUp = false,
): DueVerdict {
  if (!nextRunAt || nextRunAt > now) return 'wait'
  if (now - nextRunAt <= CATCH_UP_WINDOW_MS) return 'fire'
  return catchUp ? 'late' : 'missed'
}

/** How overdue, in the roundest unit that is still true. */
export function describeLateness(lateBy: number): string {
  const hours = Math.round(lateBy / (60 * 60_000))
  if (hours < 1) return 'less than an hour'
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`

  const days = Math.round(hours / 24)
  return `${days} days`
}

/**
 * The instruction, told that it is arriving late.
 *
 * Appended as trailing context rather than woven in, for the reason
 * `promptFor` gives: the instruction somebody wrote has to still be the one
 * that arrives. It matters because most of these rituals are written in the
 * present tense — "what came in overnight", "what is on for today" — and a run
 * that does not know it is six hours late will answer as though it is not.
 */
export function latePrompt(input: string, lateBy: number): string {
  return `${input}

This run is late: it was due ${describeLateness(lateBy)} ago, and nothing was running then. Anything you would describe as "today" or "this morning" should account for that.`
}

/** A row that says so, since a late run is not the same as a punctual one. */
export function lateTitle(title: string, lateBy: number): string {
  return `${title} · ${describeLateness(lateBy)} late`
}

let timer: ReturnType<typeof setInterval> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
/** Schedules with a run currently in flight, so a slow run can't stack up. */
const inFlight = new Set<string>()

export function startScheduler(): void {
  if (timer) return

  // A first pass shortly after boot catches anything due while we were down.
  setTimeout(() => void tick(), 5_000)
  timer = setInterval(() => void tick(), TICK_MS)

  // Slower than the clock tick on purpose: this one leaves the machine and
  // asks GitHub, once per triggered ritual. Thirty seconds would be rude to
  // somebody else's rate limit for no gain — nothing here is urgent to the
  // second.
  //
  // Watched pull requests ride the same interval and are deliberately *not*
  // awaited behind the event poll. `pollEventsOnce` awaits `fire()`, which can
  // sit for the ten-minute retry delay — long enough that a pull request going
  // green would not be noticed until the ritual it has nothing to do with had
  // finished. Separate re-entrancy guards, one timer.
  setTimeout(() => {
    void pollEvents()
    void pollWatchedPullRequests()
    void tickInbox()
    void tickDigestDelivery()
    void tickDigestCommands()
    void refreshBrief()
  }, 15_000)

  pollTimer = setInterval(() => {
    void pollEvents()
    void pollWatchedPullRequests()
    // Rides this timer rather than the 30-second clock tick because a refresh
    // takes half a minute and being asked four times while running is pointless.
    // Un-awaited alongside the others for the same reason they are: one slow
    // source must not delay a pull request going green from being noticed.
    void tickInbox()
    // One message a day at most, and `dueForDelivery` is a file read until the
    // minute it is due — so riding this timer costs nothing on every other tick.
    void tickDigestDelivery()
    // The return leg: replies to that message, read on the same interval the
    // event triggers use. `commandsRefusal` is a file read and refuses until
    // somebody has switched it on and pointed it at a direct message, so on
    // almost every machine this costs one `readDelivery` every two minutes.
    void tickDigestCommands()
    // Not a schedule and not a run: the brief is assembled from files this
    // machine already has, so it is rebuilt on the poll rather than at the
    // moment a run needs it. A run that had to wait for it would be paying for
    // the assembly in latency, every time.
    void refreshBrief()
  }, POLL_MS)

  console.log('[scheduler] started')
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  if (pollTimer) clearInterval(pollTimer)
  timer = null
  pollTimer = null
}

/**
 * One poll at a time.
 *
 * `pollEvents` awaits `fire()`, and a ritual can easily outlast the two-minute
 * interval — a triage run on a large pull request routinely does. The next tick
 * then started while the first was still inside its loop, read the cursor as it
 * had been *before* the first invocation's later events, and fired the same
 * pull requests a second time. Money spent twice on identical work.
 */
let polling = false

export async function pollEvents(): Promise<void> {
  if (polling) return
  polling = true

  try {
    await pollEventsOnce()
  } finally {
    polling = false
  }
}

/**
 * The same protection for the watched pull requests, on its own flag.
 *
 * A watch that starts a fix turn returns immediately — the turn is detached —
 * but reading a dozen pull requests through `gh` on a slow connection can still
 * outlast two minutes, and overlapping passes would hand the same red commit to
 * two turns before either had recorded that it was handling it.
 */
let watching = false

export async function pollWatchedPullRequests(): Promise<void> {
  if (watching) return
  watching = true

  try {
    await pollPullRequests()
  } finally {
    watching = false
  }
}

/**
 * Ask GitHub what has happened, and fire the rituals waiting on it.
 *
 * Each triggered ritual is polled independently and failures are per-ritual:
 * one repository with no remote must not stop the others being asked.
 */
async function pollEventsOnce(): Promise<void> {
  let triggered: Schedule[]

  try {
    triggered = (await scheduleStore.read())
      .filter(schedule => schedule.enabled && schedule.trigger && !inFlight.has(schedule.id))
  } catch (e) {
    console.error('[scheduler] could not read schedules for polling', e)
    return
  }

  for (const schedule of triggered) {
    const poll = await pollTrigger(schedule.trigger!, schedule.projectDir)

    // Null is "could not ask", which is not "nothing happened". Advancing the
    // cursor here would swallow everything that arrived while gh was unhappy.
    if (!poll) continue

    /**
     * More happened than one window can hold, so the cursor is about to step
     * over things nobody will ever be told about — unless they are told here.
     *
     * Said once per gap rather than every two minutes: the flag stays set until
     * a poll reaches its own cursor again, and the notification only goes out on
     * the poll that first finds it.
     */
    const gap = hasGap(schedule.triggerCursor, poll.reachedBack)

    if (gap !== Boolean(schedule.eventGapAt)) {
      await setEventGap(schedule.id, gap ? Date.now() : undefined)

      if (gap) {
        console.log(`[scheduler] "${schedule.title}": more happened than one poll can see`)
        await notify(
          'needsYou',
          `${schedule.title} could not see everything`,
          'More happened here than one poll can look back over, so some of it was never '
          + 'picked up. It carries on from what it can see.',
          '/schedules',
        )
      }
    }

    const { fire: firing, cursor, deferred } = selectNew(poll.events, schedule.triggerCursor)

    if (deferred > 0) {
      console.log(`[scheduler] "${schedule.title}": ${deferred} more waiting, will fire next poll`)
    }

    /**
     * Nothing to fire, but a baseline to record.
     *
     * The first poll of a trigger writes where things stood so that turning one
     * on does not start work on every pull request already open. That is the
     * only case where the cursor moves without something running.
     */
    if (!firing.length) {
      if (cursor !== schedule.triggerCursor) await setTriggerCursor(schedule.id, cursor)
      continue
    }

    for (const event of firing) {
      // Claimed the same way a due clock ritual is, so the next poll cannot
      // start a second run of it while this one is still going.
      if (inFlight.has(schedule.id)) break
      inFlight.add(schedule.id)

      const ran = await fire(schedule, event)

      /**
       * Advanced per event, and only once that event has actually run.
       *
       * It used to move past everything before firing any of it, so an event
       * whose run was skipped — over the daily cap, or held back near the rate
       * limit — was stepped over and never seen again. Not fired later, and not
       * reported either: a trigger has no `missedAt`, so the schedules page and
       * the morning digest both said nothing at all. The same hole swallowed
       * anything in flight when the process stopped.
       *
       * Leaving the cursor where it is means a skipped event is simply still
       * new next time, which is what "skipped" should mean.
       */
      if (!ran) break

      await setTriggerCursor(schedule.id, event.key)
    }
  }
}

/** A ritual whose turn has come, and how overdue it was when it did. */
interface DueRitual {
  schedule: Schedule
  lateBy?: number
}

export async function tick(now = Date.now()): Promise<void> {
  let due: DueRitual[]

  try {
    // Decide and record inside one locked read-modify-write. Doing this as a
    // read, then a loop, then a bulk write would overwrite whatever `markRan`
    // committed in between — leaving `nextRunAt` in the past and firing the
    // ritual a second time on the next tick.
    due = await scheduleStore.update((schedules) => {
      const firing: DueRitual[] = []

      for (const schedule of schedules) {
        if (!schedule.enabled) continue
        if (inFlight.has(schedule.id)) continue
        // Waiting for something to happen rather than for a time to arrive.
        // Its `recurrence` is still on the record and still meaningless here.
        if (schedule.trigger) continue

        // First sight of this schedule, or a corrupted record.
        if (!schedule.nextRunAt) {
          schedule.nextRunAt = computeNextRun(schedule.recurrence, new Date(now))
          continue
        }

        const verdict = dueVerdict(schedule.nextRunAt, now, schedule.catchUp)
        if (verdict === 'wait') continue

        if (verdict === 'missed') {
          // Too stale to be useful — skip to the next occurrence without
          // running. Recorded rather than done quietly: this is what happens
          // every time the machine was shut at 08:00, and it used to be the
          // only way a ritual could produce nothing without saying so.
          //
          // Written on the schedule rather than as a failed run, because
          // nothing was attempted. A run here would join the failing streak
          // and turn the ritual off after three shut laptops.
          //
          // Set inside this same locked write rather than through a second
          // call, so the note and the advanced time land together.
          schedule.missedAt = schedule.nextRunAt
          schedule.missedNoticedAt = now
          schedule.nextRunAt = computeNextRun(schedule.recurrence, new Date(now))
          continue
        }

        // Claim it here, so a second tick cannot pick it up while the run is
        // still being started.
        inFlight.add(schedule.id)
        firing.push({
          // Copied before `markRan` moves `nextRunAt` on, so how overdue this
          // occurrence was is worked out here and carried rather than
          // recomputed later against a time that has since changed.
          schedule: { ...schedule },
          lateBy: verdict === 'late' ? now - schedule.nextRunAt : undefined,
        })
      }

      return firing
    })
  } catch (e) {
    console.error('[scheduler] could not read schedules', e)
    return
  }

  // No event: these came round on the clock, which is the only way a run can
  // be late in the first place.
  for (const item of due) void fire(item.schedule, undefined, item.lateBy)
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
    await notify('failed', `${title} failed`, run.error || 'The run ended early.', runPath(run))
  } else if (outcome === 'blocked') {
    // Same outcome, two quite different mornings. Told apart here because the
    // notification is often the only account of it anybody reads.
    const headline = run.stoppedBy ? `${title} ran out` : `${title} was blocked`
    await notify('needsYou', headline, describeIncomplete(run), runPath(run))
  } else if (outcome === 'ok') {
    await notify('finished', title, run.output || 'Finished with nothing to report.', runPath(run))
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

/**
 * Already claimed in `inFlight` by the tick that selected it.
 *
 * Returns whether the work actually ran. A clock ritual does not care — its
 * next occurrence is computed either way — but a triggered one must not step
 * its cursor past an event that was skipped, or that event is lost for good.
 */
async function fire(schedule: Schedule, event?: TriggerEvent, lateBy?: number): Promise<boolean> {
  try {
    // The case the daily limit exists for: work that spends money at 08:00
    // with nobody watching. Skipped without starting, and said out loud —
    // a ritual that silently stopped running would be worse than the bill.
    const budget = await checkBudget(Date.now(), { unattended: true })
    if (!budget.allowed) {
      console.log(`[scheduler] skipping "${schedule.title}": ${budget.reason}`)
      await skipToNextRun(schedule.id)
      await notify('failed', `${schedule.title} was skipped`, budget.reason!, '/schedules')
      return false
    }

    // Where this ritual stood *before* today's attempt. It decides whether a
    // failure is a bad morning or the latest in a run of them, so it has to be
    // read before the run that is about to join it.
    const before = await historyFor(schedule.id)

    const run = await runOnce(schedule, budget.maxBudgetUsd, event, lateBy)
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
        const again = await runOnce(schedule, retryBudget.maxBudgetUsd, event, lateBy)
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
      await notify('needsYou', `${schedule.title} has been turned off`, verdict.reason, '/schedules')
    }

    return true
  } catch (e) {
    console.error(`[scheduler] "${schedule.title}" failed to start`, e)
    // It got as far as trying, which is enough for a trigger to move past the
    // event: firing it again would reproduce the same failure, for money.
    return true
  } finally {
    inFlight.delete(schedule.id)
  }
}

/**
 * One attempt, start to finish, recorded against the ritual.
 *
 * `event` is what set it off, when something did. It decides both the prompt —
 * which has to say which pull request this is about — and the name on the row,
 * so a ritual that fired five times is five distinguishable rows rather than
 * five copies of its own title.
 */
async function runOnce(
  schedule: Schedule,
  maxBudgetUsd: number | undefined,
  event?: TriggerEvent,
  lateBy?: number,
): Promise<Run> {
  const options = await resolveRunOptionsFor({
    // Nobody is at the keyboard, which is what lets a sandboxed command skip
    // the prompt it would otherwise stop on.
    unattended: true,
    projectDir: schedule.projectDir,
    agentSlug: schedule.agentSlug,
    // The trust level was chosen when the ritual was created, so a run at 8am
    // doesn't have to ask a question nobody is there to answer.
    permissionMode: permissionModeFor(schedule.permission),
    allowRules: schedule.allowRules,
  })

  // The name a row carries, before a step is appended to it. An event says
  // which one this was about; lateness says it did not happen when it should
  // have. A ritual cannot be both, since only a clock ritual can run late.
  const title = event
    ? titleFor(schedule.title, event)
    : lateBy ? lateTitle(schedule.title, lateBy) : schedule.title

  /**
   * What the written instruction picks up on its way out.
   *
   * One function so the chain and the single-instruction path cannot drift —
   * a late chain whose steps were not told they were late would answer in the
   * present tense all the way through.
   */
  const decorate = (base: string): string => {
    const withEvent = event ? promptFor(base, event) : base
    return lateBy ? latePrompt(withEvent, lateBy) : withEvent
  }

  if (schedule.steps?.length) {
    return runChain(schedule, schedule.steps, title, options, maxBudgetUsd, decorate)
  }

  const run = createRun({
    kind: 'command',
    title,
    input: decorate(schedule.input),
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

function newChainId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * A chained ritual, run as one firing.
 *
 * Each step is its own run — its own transcript, its own cost, its own row —
 * tied together by a `chainId` that the history collapses back into one entry.
 * That split is the whole design: separate where the detail is useful, one
 * thing where the *judgement* is made.
 *
 * **Returns the last step that ran**, and that is exactly the run whose outcome
 * is the chain's. Because the loop stops at the first step that comes back
 * anything other than `ok`, the last executed step always carries the verdict —
 * so `announce`, `shouldRetry` and `shouldGiveUp` all keep working on a single
 * run without knowing chains exist.
 */
async function runChain(
  schedule: Schedule,
  steps: NonNullable<Schedule['steps']>,
  title: string,
  options: Awaited<ReturnType<typeof resolveRunOptionsFor>>,
  maxBudgetUsd: number | undefined,
  decorate: (base: string) => string,
): Promise<Run> {
  const chainId = newChainId()
  const done: { title: string; output: string }[] = []
  let last: Run | null = null

  for (const [index, step] of steps.entries()) {
    /**
     * Re-checked between steps, never before the first — `fire` has just asked.
     *
     * A chain is several agent invocations under one firing, so it is the one
     * place where the daily limit can be reached partway through the work. The
     * alternative is a cap that is checked once and then exceeded by however
     * much the remaining steps cost.
     */
    if (index > 0) {
      const budget = await checkBudget(Date.now(), { unattended: true })
      if (!budget.allowed) {
        console.log(`[scheduler] "${schedule.title}" stopped after ${index} of ${steps.length}: ${budget.reason}`)
        // Announced in its own right. `announce` will describe the last step,
        // which finished perfectly well and says nothing about the steps that
        // never started.
        await notify(
          'needsYou',
          `${schedule.title} stopped partway`,
          `${index} of ${steps.length} steps ran. ${budget.reason}`,
          '/schedules',
        )
        break
      }
    }

    const base = chainPrompt(step, done)

    const run = createRun({
      kind: 'command',
      title: stepTitleFor(title, step, index, steps.length),
      input: decorate(base),
      invocation: schedule.invocation,
      agentSlug: schedule.agentSlug,
      projectDir: options.cwd,
      scheduleId: schedule.id,
      chainId,
      stepIndex: index,
    })

    // Once, on the first step, for the same reason a plain ritual does it
    // before its run finishes: a chain easily outlasts a tick, and the schedule
    // has to be past due before the next one looks at it.
    if (index === 0) await markRan(schedule.id, run.id)

    console.log(`[scheduler] "${schedule.title}" step ${index + 1}/${steps.length} as ${run.id}`)
    await withRunSlot(() => executeRun(run, options, { unattended: true, maxBudgetUsd }))
    last = run

    // Verifying a fix that failed is a way to spend money confirming it.
    if (!shouldContinue(outcomeOf(run))) {
      console.log(`[scheduler] "${schedule.title}" stopped at step ${index + 1}: ${outcomeOf(run)}`)
      break
    }

    done.push({ title: step.title, output: run.output })
  }

  /**
   * The first step always runs: `runOnce` only comes here with steps, and the
   * budget re-check is skipped for `index === 0`. So there is always a last
   * run, and the alternative — inventing a failed run to return — would put a
   * fabricated entry in the history for a case that cannot happen.
   */
  if (!last) throw new Error(`"${schedule.title}" has a chain with no steps`)

  return last
}
