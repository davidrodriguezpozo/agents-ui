import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import { mergeRules } from './permissionRules'
import { permissionModeFor, type TrustLevel } from './trust'
import { describeTrigger, type EventTrigger } from './eventTriggers'
import { normalizeSteps, type ChainStep } from './ritualChain'

/**
 * Deliberately not cron. "Every weekday at 08:00" is the shape a daily ritual
 * actually takes, and it's something a salesperson can read. All times are the
 * machine's local time, which is what people mean by "8am".
 */
export interface Recurrence {
  hour: number
  minute: number
  /** Days of the week, Sunday = 0. Empty means every day. */
  days: number[]
}

/**
 * How much a ritual is trusted. Decided when it's created, because 8am with
 * nobody watching is the wrong moment to ask. Shared with sessions, which ask
 * the same question about a turn you are watching.
 */
export type SchedulePermission = TrustLevel

export interface Schedule {
  id: string
  title: string
  /**
   * The prompt to run, e.g. `/hd:goodmorning`.
   *
   * Still the instruction for a plain ritual, and still what a chained one
   * falls back to if its steps are ever removed — the same reasoning that keeps
   * `recurrence` on a triggered ritual rather than making the record a union.
   */
  input: string
  /**
   * An ordered list of instructions instead of one, run in sequence, each
   * carrying what the last one produced.
   *
   * Absent means this is a plain ritual, which is what every ritual written
   * before chains existed is. Present means `input` is not what runs.
   */
  steps?: ChainStep[]
  invocation?: string
  agentSlug?: string
  projectDir?: string
  recurrence: Recurrence
  /**
   * Fire on something happening instead of on the clock.
   *
   * Absent means this is a clock ritual, which is what every ritual written
   * before this existed is. `recurrence` stays on the record either way rather
   * than becoming a union — it is what the row falls back to describing if a
   * trigger is ever removed, and losing somebody's 08:00 because they tried an
   * event trigger for a day would be a poor trade.
   */
  trigger?: EventTrigger
  /**
   * Highest event key already seen, so the same pull request is not worked on
   * twice. Absent means this trigger has never been polled — the first poll
   * records a baseline and fires nothing.
   */
  triggerCursor?: number
  /**
   * Whether an occurrence too late to be on time should still run.
   *
   * Off by default, which is what every ritual did before this existed, and the
   * right default: a briefing about this morning is worth less at 14:00 than it
   * was at 08:00, and dumping yesterday's on somebody at teatime is the thing
   * the catch-up window was added to prevent.
   *
   * It is a per-ritual choice because the answer genuinely differs by ritual. A
   * morning briefing is stale the moment it is late. A triage run over what came
   * in overnight is worth having whenever it happens, and skipping it means the
   * work simply never gets done.
   */
  catchUp?: boolean
  permission: SchedulePermission
  /**
   * Rules this ritual has been granted permanently, e.g. `Bash(gh:*)`.
   * Narrower and safer than raising `permission` to 'full'.
   */
  allowRules?: string[]
  enabled: boolean
  /** `team` rituals came from an installed plugin; `user` ones were made here. */
  origin: 'user' | 'team'
  /** For team rituals — which plugin suggested it. */
  pluginName?: string
  createdAt: number
  lastRunAt?: number
  lastRunId?: string
  nextRunAt?: number
  /**
   * Why the scheduler turned this off by itself, when it did.
   *
   * `enabled: false` on its own is ambiguous — it is also what the switch on
   * the row means. Without this, a ritual that stopped because it had broken
   * would be indistinguishable from one somebody paused on purpose, and the
   * only thing worth knowing is which. Cleared the moment it is turned back on.
   */
  pausedReason?: string
  pausedAt?: number
  /**
   * The occurrence that came and went while nothing was running.
   *
   * A ritual due at 08:00 on a laptop that was shut is not a ritual that
   * failed — nothing was attempted, so there is nothing to blame it for. But
   * until this existed it was also not a ritual that *said* anything: the
   * scheduler moved it to tomorrow and the morning simply had no briefing in
   * it, with nothing anywhere to explain why.
   *
   * Every other way a ritual produces no work is loud. This was the quietest
   * and the most common, because it happens every time the machine was asleep.
   *
   * Deliberately **not** a run. A skipped run in the log would count against
   * the failing streak, and three shut laptops in a row would then turn the
   * ritual off for good — which is the precise opposite of what somebody
   * whose laptop was shut wants to come back to.
   */
  missedAt?: number
  /** When we noticed, which is when the machine came back. */
  missedNoticedAt?: number
  /**
   * When a poll last could not see back as far as it had already got to.
   *
   * The event window holds fifty items. That covers a weekend and does not
   * cover a fortnight, so a machine shut for long enough comes back to a
   * repository where more happened than one poll can see — and the cursor then
   * steps over the difference, permanently.
   *
   * The same shape of problem as `missedAt`, and recorded the same way and for
   * the same reason. Nothing failed, so this must never become a run: it would
   * join the failing streak and turn the ritual off for coming back from
   * holiday. It is cleared by the first poll that reaches its own cursor again.
   */
  eventGapAt?: number
}

/**
 * Rituals are the one thing here that cannot be reconstructed from anywhere
 * else — a worktree can rebuild a session, but nothing remembers that someone
 * wanted a briefing at 08:00 on weekdays. Losing this file loses real work,
 * which is why it must never be treated as empty just because it failed to
 * parse: the next save would make that permanent.
 */
export const scheduleStore = defineJsonStore<Schedule[]>({
  label: 'daily rituals',
  path: () => join(getClaudeDir(), 'agents-ui', 'schedules.json'),
  empty: () => [],
  // Rituals written before trust levels existed have no `permission`. Default
  // on read so both the scheduler and the UI see a complete record.
  decode: parsed => (parsed?.schedules ?? []).map((schedule: Schedule) => ({
    ...schedule,
    permission: schedule.permission ?? 'edits',
    allowRules: schedule.allowRules ?? [],
  })),
  encode: schedules => ({ version: 1, schedules }),
})

export async function readSchedules(): Promise<Schedule[]> {
  return scheduleStore.read()
}

export async function writeSchedules(schedules: Schedule[]): Promise<void> {
  return scheduleStore.write(schedules)
}

export function newScheduleId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function normalizeRecurrence(recurrence: Partial<Recurrence> | undefined): Recurrence {
  const hour = Math.max(0, Math.min(Math.floor(recurrence?.hour ?? 9), 23))
  const minute = Math.max(0, Math.min(Math.floor(recurrence?.minute ?? 0), 59))
  const days = (recurrence?.days ?? [])
    .map(Number)
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
  return { hour, minute, days: [...new Set(days)].sort() }
}

/** Next moment at or after `from` that matches the recurrence. */
export function computeNextRun(recurrence: Recurrence, from: Date = new Date()): number {
  const { hour, minute, days } = normalizeRecurrence(recurrence)

  for (let offset = 0; offset <= 8; offset++) {
    const candidate = new Date(from)
    candidate.setDate(candidate.getDate() + offset)
    candidate.setHours(hour, minute, 0, 0)

    if (candidate.getTime() <= from.getTime()) continue
    if (days.length && !days.includes(candidate.getDay())) continue

    return candidate.getTime()
  }

  // Unreachable for any valid day set, but never return a past time.
  return from.getTime() + 86_400_000
}

/**
 * What this ritual waits for, however it waits. The row asks one question —
 * "when does this happen" — and a trigger is as much an answer as a time is.
 */
export function describeSchedule(schedule: Pick<Schedule, 'recurrence' | 'trigger'>): string {
  return schedule.trigger ? describeTrigger(schedule.trigger) : describeRecurrence(schedule.recurrence)
}

export function describeRecurrence(recurrence: Recurrence): string {
  const { hour, minute, days } = normalizeRecurrence(recurrence)
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  if (!days.length) return `Every day at ${time}`
  if (days.length === 7) return `Every day at ${time}`

  const weekdays = [1, 2, 3, 4, 5]
  if (days.length === 5 && weekdays.every(d => days.includes(d))) {
    return `Weekdays at ${time}`
  }

  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${days.map(d => names[d]).join(', ')} at ${time}`
}

export { permissionModeFor }

/**
 * Which repository a ritual should be pinned to when it is saved.
 *
 * Three answers, not two, which is why this is not a `??` chain:
 *
 *   - A named project is used as given, on a new ritual or an edit.
 *   - `null` means "none, on purpose" — the ritual runs against your personal
 *     `~/.claude` alone. Without a way to say this, a ritual could be pinned but
 *     never unpinned, because "no project" and "did not say" would be the same
 *     value.
 *   - Absent means "did not say". On a new ritual that takes the project you
 *     are in, because the scheduler has no idea what is selected at 08:00 and
 *     there is nobody to ask. On an edit it takes nothing, so changing a
 *     ritual's time from a different project does not quietly move where it
 *     runs — invisible while there was only one project to be in.
 */
export function projectDirForSave(
  body: { id?: string; projectDir?: string | null },
  currentProjectDir: string | null,
): string | null | undefined {
  if (body.projectDir === null) return null
  if (body.projectDir) return body.projectDir
  if (body.id) return undefined
  return currentProjectDir ?? undefined
}

export async function upsertSchedule(
  input: Partial<Omit<Schedule, 'projectDir' | 'trigger' | 'steps'>>
    & {
      input: string
      title: string
      projectDir?: string | null
      trigger?: EventTrigger | null
      steps?: ChainStep[] | null
    },
): Promise<Schedule> {
  const recurrence = normalizeRecurrence(input.recurrence)

  return scheduleStore.update((schedules) => {
    const existingIndex = input.id ? schedules.findIndex(s => s.id === input.id) : -1
    const existing = existingIndex >= 0 ? schedules[existingIndex] : undefined

    const schedule: Schedule = {
      id: input.id || newScheduleId(),
      title: input.title,
      input: input.input,
      invocation: input.invocation ?? existing?.invocation,
      agentSlug: input.agentSlug ?? existing?.agentSlug,
      // `null` is "no project, on purpose" and must clear what is there;
      // absent is "did not say" and must keep it. See projectDirForSave.
      projectDir: input.projectDir === null ? undefined : input.projectDir ?? existing?.projectDir,
      recurrence,
      catchUp: input.catchUp ?? existing?.catchUp ?? false,
      permission: input.permission ?? existing?.permission ?? 'edits',
      allowRules: mergeRules(input.allowRules ?? existing?.allowRules ?? []),
      enabled: input.enabled ?? existing?.enabled ?? true,
      origin: input.origin ?? existing?.origin ?? 'user',
      pausedReason: existing?.pausedReason,
      pausedAt: existing?.pausedAt,
      pluginName: input.pluginName ?? existing?.pluginName,
      createdAt: existing?.createdAt ?? Date.now(),
      // Preserve run history: an edit must not make a ritual look like it has
      // never fired, or the scheduler will treat it as brand new.
      lastRunAt: existing?.lastRunAt,
      lastRunId: existing?.lastRunId,
      nextRunAt: computeNextRun(recurrence),
      // `null` clears a trigger and returns this to the clock, the same way it
      // clears a project. Absent keeps whatever is there.
      trigger: input.trigger === null ? undefined : input.trigger ?? existing?.trigger,
      triggerCursor: existing?.triggerCursor,
      /**
       * `null` returns a chain to being a single instruction, the same way it
       * clears a trigger or a project. Absent keeps whatever is there.
       *
       * Anything else is normalized and taken as given — including when it
       * normalizes to nothing. Falling back to the stored steps in that case
       * would mean sending a chain trimmed to one step left the old chain in
       * place, so the record would disagree with what was just saved.
       */
      steps: input.steps === null
        ? undefined
        : input.steps === undefined
          ? existing?.steps
          : normalizeSteps(input.steps),
    }

    /**
     * A trigger that changed has never been polled, so its cursor belongs to a
     * question nobody is asking any more. Keeping it would mean switching from
     * pull requests to failed checks and then firing for every workflow run
     * whose id happens to exceed some pull request number — which is most of
     * them, immediately.
     */
    const triggerChanged = existing?.trigger?.kind !== schedule.trigger?.kind
      // Every narrowing counts, for one reason: a cursor set while a filter was
      // narrow has already advanced past events the filter excluded. Widening
      // it would mean those never fire and never appear, so a changed filter
      // re-baselines instead — nothing fires, and it starts from now.
      || existing?.trigger?.branch !== schedule.trigger?.branch
      || existing?.trigger?.label !== schedule.trigger?.label
      || existing?.trigger?.reviewer !== schedule.trigger?.reviewer
      // The repository counts too. Pull request numbers and workflow run ids
      // are per repository, so a ritual repointed from one where they reached
      // 400 to one whose PRs are in the tens keeps a high-water mark nothing
      // can ever exceed — and silently never fires again.
      || existing?.projectDir !== schedule.projectDir
    if (triggerChanged) schedule.triggerCursor = undefined

    // A ritual that is on is not paused. Turning it back on is somebody saying
    // they want it to run again; whatever it broke on before is last week's
    // problem, and a reason left on the row would go on accusing it of it.
    if (schedule.enabled) {
      schedule.pausedReason = undefined
      schedule.pausedAt = undefined
    }

    if (existingIndex >= 0) schedules[existingIndex] = schedule
    else schedules.push(schedule)

    return schedule
  })
}

export async function deleteSchedule(id: string): Promise<boolean> {
  return scheduleStore.update((schedules) => {
    const index = schedules.findIndex(s => s.id === id)
    if (index < 0) return false
    schedules.splice(index, 1)
    return true
  })
}

/**
 * Advance a ritual past the run it just started. This races the scheduler's own
 * tick and any edit the user makes, so it has to re-read under the lock — an
 * overwrite here would leave `nextRunAt` in the past and fire the ritual twice.
 */
/**
 * Move a ritual on to its next occurrence without recording a run.
 *
 * For a firing that was skipped rather than attempted — over the daily
 * spending limit, say. `nextRunAt` has to advance regardless or the tick would
 * pick it up again half a minute later, and keep doing so all day. But
 * `lastRunAt` and `lastRunId` are left alone: nothing ran, and writing a
 * non-run into the history would make a skipped ritual look like a failing one.
 */
export async function skipToNextRun(id: string): Promise<void> {
  await scheduleStore.update((schedules) => {
    const schedule = schedules.find(s => s.id === id)
    if (!schedule) return

    schedule.nextRunAt = computeNextRun(schedule.recurrence)
  })
}

/**
 * Stop firing a ritual that has broken, and record what it broke on.
 *
 * Deliberately the same `enabled: false` the switch on the row sets, so there
 * is one idea of "off" rather than two that can disagree. The reason beside it
 * is what makes the two distinguishable to a person.
 */
export async function pauseRitual(id: string, reason: string): Promise<void> {
  await scheduleStore.update((schedules) => {
    const schedule = schedules.find(s => s.id === id)
    if (!schedule) return

    schedule.enabled = false
    schedule.pausedReason = reason
    schedule.pausedAt = Date.now()
  })
}

/**
 * How far a trigger has been caught up.
 *
 * Written whether or not anything fired: the first poll records a baseline so
 * that turning on "when a pull request is opened" does not immediately start
 * work on every pull request already open.
 */
export async function setTriggerCursor(id: string, cursor: number): Promise<void> {
  await scheduleStore.update((schedules) => {
    const schedule = schedules.find(s => s.id === id)
    if (!schedule) return

    schedule.triggerCursor = cursor
  })
}

/**
 * Note that a poll could not see back to its own cursor, or that one since has.
 *
 * Written on the schedule rather than as a run, for the reason `missedAt` is:
 * nothing was attempted and nothing failed, and a record in the run log would
 * count against the failing streak and eventually turn the ritual off.
 */
export async function setEventGap(id: string, at: number | undefined): Promise<void> {
  await scheduleStore.update((schedules) => {
    const schedule = schedules.find(s => s.id === id)
    if (!schedule) return

    schedule.eventGapAt = at
  })
}

export async function markRan(id: string, runId: string): Promise<void> {
  await scheduleStore.update((schedules) => {
    const schedule = schedules.find(s => s.id === id)
    if (!schedule) return

    schedule.lastRunAt = Date.now()
    schedule.lastRunId = runId
    schedule.nextRunAt = computeNextRun(schedule.recurrence)

    // It has just run, so whatever it missed before is no longer outstanding.
    // Leaving it would have the row go on reporting a morning that has since
    // been made good.
    schedule.missedAt = undefined
    schedule.missedNoticedAt = undefined
  })
}
