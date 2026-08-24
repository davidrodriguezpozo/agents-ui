import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import {
  readSharedProject,
  updateSharedProject,
  type SharedProblem,
  type SharedRitual,
} from './sharedProject'
import { defineJsonStore } from './jsonStore'
import { mergeRules } from './permissionRules'
import { permissionModeFor, type TrustLevel } from './trust'
import { describeTrigger, type EventTrigger } from './eventTriggers'
import { normalizeSteps, type ChainStep } from './ritualChain'
import type { RitualExpectation } from './ritualValue'
import type { ProviderId } from './providers/types'

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
  /**
   * Which agent this ritual's runs go through. **Absent means Claude Code**,
   * which is what every ritual written before this existed used.
   *
   * Worth being blunt about one consequence: a ritual on a provider that cannot
   * stop to ask has no way to be granted a tool mid-run, so its allow list is
   * the whole of what it can do. `suggestedRules` still accumulates, and the
   * refusals still show on the run, so the ritual can be widened afterwards —
   * but it will fail the first time rather than wait to be let through.
   */
  provider?: ProviderId
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
   * What this ritual is for, and therefore what it is fair to judge it on.
   *
   * Absent means nobody has said, and the row reads it off whether the ritual
   * has landed anything. That default has to exist — every ritual written
   * before this field did without it — but it is only a default: a ritual that
   * is meant to land code and has not landed any for a month looks exactly like
   * a briefing until somebody says which it is, and those two deserve opposite
   * sentences on the row.
   */
  expects?: RitualExpectation
  /**
   * Rules this ritual has been granted permanently, e.g. `Bash(gh:*)`.
   * Narrower and safer than raising `permission` to 'full'.
   */
  allowRules?: string[]
  enabled: boolean
  /**
   * Where the definition came from. `user` was made here, `team` was adopted
   * from an installed plugin — a one-time copy, after which it is this
   * machine's — and `repository` is the live one: its definition is owned by
   * the project's shared file and is refreshed from it, so editing it here
   * writes a commit rather than a local record. See `sharedProject.ts`.
   */
  origin: 'user' | 'team' | 'repository'
  /** For team rituals — which plugin suggested it. */
  pluginName?: string
  /**
   * The shared ritual this row is, named the way the repository names it.
   *
   * Present exactly when `origin` is `repository`. The id beside it is this
   * machine's and means nothing to anybody else, which is why the pairing of
   * key and `projectDir` is what identifies a shared ritual across checkouts.
   */
  sharedKey?: string
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
  input: Partial<Omit<Schedule, 'projectDir' | 'trigger' | 'steps' | 'expects'>>
    & {
      input: string
      title: string
      projectDir?: string | null
      trigger?: EventTrigger | null
      steps?: ChainStep[] | null
      expects?: RitualExpectation | null
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
      // `null` puts the judgement back to being read off the records, which
      // absent cannot say — absent keeps whatever was chosen before.
      expects: input.expects === null ? undefined : input.expects ?? existing?.expects,
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

// --- Rituals the repository owns --------------------------------------------

/**
 * Bring this machine's list in line with what the repository shares.
 *
 * A shared ritual is two things kept deliberately apart. Its *definition* — the
 * title, the instruction, the time — belongs to the project and is refreshed
 * from `.claude/agents-studio.json` every time this runs, so a colleague's
 * commit changes it here without anybody re-entering it. Its *state* — when it
 * last ran, what that run was, whether this machine has it turned on — is local
 * and is never touched by a sync. Sharing a ritual shares the intent, not the
 * history.
 *
 * Two decisions in here are safety decisions rather than convenience ones:
 *
 *   - **A shared ritual arrives turned off.** A `git pull` that starts running
 *     something at 08:00 is a side effect of a pull, which is not a thing this
 *     app is allowed to be. The row appears, says where it came from and says
 *     it is off; turning it on is a decision made on this machine.
 *   - **The file cannot carry trust.** `permission` is not a shared field and is
 *     defaulted to `readonly` here. A definition somebody else committed must
 *     not arrive holding the right to edit this checkout — raising that is a
 *     local decision about a local machine, every time.
 *
 * Returns what changed, so a caller can say so, plus whatever the file got
 * wrong. Never throws: a project that shares nothing, or shares something
 * unreadable, must not stop the ritual list from being read.
 */
export async function syncSharedRituals(repoDir: string | undefined): Promise<{
  added: string[]
  updated: string[]
  removed: string[]
  problems: SharedProblem[]
}> {
  const result = { added: [] as string[], updated: [] as string[], removed: [] as string[], problems: [] as SharedProblem[] }
  if (!repoDir) return result

  let read: Awaited<ReturnType<typeof readSharedProject>>
  try {
    read = await readSharedProject(repoDir)
  } catch {
    return result
  }

  result.problems = read.problems

  // Nothing shared and nothing ever shared: leave the store alone entirely,
  // which is the common case and must not rewrite the file on every read.
  const shared = read.config.rituals ?? []
  const store = await scheduleStore.read()
  const ours = store.filter(s => s.sharedKey && s.projectDir === repoDir)
  if (!shared.length && !ours.length) return result

  await scheduleStore.update((schedules) => {
    const byKey = new Map(shared.map(ritual => [ritual.key, ritual]))

    for (let i = schedules.length - 1; i >= 0; i--) {
      const existing = schedules[i]!
      if (!existing.sharedKey || existing.projectDir !== repoDir) continue

      const ritual = byKey.get(existing.sharedKey)

      // Gone from the file: the definition it was is no longer anybody's, so
      // the row goes with it. Only rows this function made are ever removed.
      if (!ritual) {
        schedules.splice(i, 1)
        result.removed.push(existing.sharedKey)
        continue
      }

      byKey.delete(existing.sharedKey)

      const next: Schedule = {
        ...existing,
        title: ritual.title,
        input: ritual.input,
        invocation: ritual.invocation,
        agentSlug: ritual.agentSlug,
        recurrence: normalizeRecurrence(ritual.recurrence),
      }

      // Only worth reporting — and only worth recomputing the next run for —
      // when the definition actually moved.
      if (JSON.stringify(next) !== JSON.stringify(existing)) {
        if (JSON.stringify(next.recurrence) !== JSON.stringify(existing.recurrence)) {
          next.nextRunAt = next.enabled ? computeNextRun(next.recurrence) : existing.nextRunAt
        }
        schedules[i] = next
        result.updated.push(existing.sharedKey)
      }
    }

    for (const ritual of byKey.values()) {
      schedules.push({
        id: newScheduleId(),
        title: ritual.title,
        input: ritual.input,
        invocation: ritual.invocation,
        agentSlug: ritual.agentSlug,
        projectDir: repoDir,
        recurrence: normalizeRecurrence(ritual.recurrence),
        catchUp: false,
        // Never from the file. See the note above.
        permission: 'readonly',
        allowRules: [],
        // Arrives off, and says why it is off rather than leaving the switch
        // looking like somebody here had paused it.
        enabled: false,
        pausedReason: 'Shared by this repository. Turn it on to run it on this machine.',
        pausedAt: Date.now(),
        origin: 'repository',
        sharedKey: ritual.key,
        createdAt: Date.now(),
      })
      result.added.push(ritual.key)
    }
  })

  return result
}

/**
 * Share a ritual, or stop sharing it.
 *
 * Writing the definition into the repository's file is the whole of "share":
 * it lands in a diff, somebody reviews it, and it arrives on the other machines
 * by pull. What is deliberately left behind is everything local — trust, run
 * history, whether it is on — for the reasons `syncSharedRituals` gives.
 */
export async function shareRitual(id: string): Promise<{ key: string; path: string } | null> {
  const schedules = await scheduleStore.read()
  const schedule = schedules.find(s => s.id === id)
  if (!schedule?.projectDir) return null

  const key = sharedRitualKey(schedule.title, schedules)

  const read = await updateSharedProject(schedule.projectDir, (config) => {
    const rituals = config.rituals ?? []
    const ritual: SharedRitual = {
      key,
      title: schedule.title,
      input: schedule.input,
      ...(schedule.invocation ? { invocation: schedule.invocation } : {}),
      ...(schedule.agentSlug ? { agentSlug: schedule.agentSlug } : {}),
      recurrence: schedule.recurrence,
    }

    const at = rituals.findIndex(existing => existing.key === key)
    if (at >= 0) rituals[at] = ritual
    else rituals.push(ritual)

    config.rituals = rituals
  })

  // The local row becomes the shared one rather than a second copy of it: two
  // rows for one ritual would fire twice.
  await scheduleStore.update((current) => {
    const at = current.findIndex(s => s.id === id)
    if (at >= 0) current[at] = { ...current[at]!, origin: 'repository', sharedKey: key }
  })

  return { key, path: read.path }
}

/**
 * Stop sharing: the definition leaves the repository's file and stays here.
 *
 * The row is kept and becomes this machine's own again, because the alternative
 * — removing it from the file and letting the next sync delete the row — would
 * make "stop sharing this" read as "delete this", which is not what anybody
 * pressing it means.
 */
export async function unshareRitual(id: string): Promise<boolean> {
  const schedules = await scheduleStore.read()
  const schedule = schedules.find(s => s.id === id)
  if (!schedule?.sharedKey || !schedule.projectDir) return false

  await updateSharedProject(schedule.projectDir, (config) => {
    const rituals = (config.rituals ?? []).filter(ritual => ritual.key !== schedule.sharedKey)
    if (rituals.length) config.rituals = rituals
    else delete config.rituals
  })

  await scheduleStore.update((current) => {
    const at = current.findIndex(s => s.id === id)
    if (at >= 0) current[at] = { ...current[at]!, origin: 'user', sharedKey: undefined }
  })

  return true
}

/**
 * A key from a title: short, stable, and the same in every checkout.
 *
 * Derived from the title rather than minted at random so that the file reads as
 * something a person wrote — `nightly-brief`, not `m4x9qz`. Collisions are
 * suffixed rather than allowed, because two shared rituals with one key is the
 * one case the reader refuses outright.
 */
export function sharedRitualKey(title: string, existing: Pick<Schedule, 'sharedKey'>[] = []): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ritual'
  const taken = new Set(existing.map(s => s.sharedKey).filter(Boolean) as string[])

  if (!taken.has(base)) return base

  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }

  return base
}
