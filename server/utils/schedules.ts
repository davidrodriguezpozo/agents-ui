import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { mergeRules } from './permissionRules'

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
 * nobody watching is the wrong moment to ask.
 */
export type SchedulePermission = 'readonly' | 'edits' | 'full'

export interface Schedule {
  id: string
  title: string
  /** The prompt to run, e.g. `/hd:goodmorning`. */
  input: string
  invocation?: string
  agentSlug?: string
  projectDir?: string
  recurrence: Recurrence
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
}

interface ScheduleFile {
  version: number
  schedules: Schedule[]
}

function schedulesPath(): string {
  return join(getClaudeDir(), 'agents-ui', 'schedules.json')
}

export async function readSchedules(): Promise<Schedule[]> {
  const path = schedulesPath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as ScheduleFile
    // Rituals written before trust levels existed have no `permission`. Default
    // on read so both the scheduler and the UI see a complete record.
    return (parsed.schedules ?? []).map(schedule => ({
      ...schedule,
      permission: schedule.permission ?? 'edits',
      allowRules: schedule.allowRules ?? [],
    }))
  } catch {
    return []
  }
}

export async function writeSchedules(schedules: Schedule[]): Promise<void> {
  const path = schedulesPath()
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify({ version: 1, schedules }, null, 2), 'utf-8')
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

/** Map a ritual's trust level onto the SDK's permission mode. */
export function permissionModeFor(permission: SchedulePermission): 'plan' | 'acceptEdits' | 'bypassPermissions' {
  if (permission === 'readonly') return 'plan'
  if (permission === 'full') return 'bypassPermissions'
  return 'acceptEdits'
}

export async function upsertSchedule(input: Partial<Schedule> & { input: string; title: string }): Promise<Schedule> {
  const schedules = await readSchedules()
  const recurrence = normalizeRecurrence(input.recurrence)

  const existingIndex = input.id ? schedules.findIndex(s => s.id === input.id) : -1
  const existing = existingIndex >= 0 ? schedules[existingIndex] : undefined

  const schedule: Schedule = {
    id: input.id || newScheduleId(),
    title: input.title,
    input: input.input,
    invocation: input.invocation ?? existing?.invocation,
    agentSlug: input.agentSlug ?? existing?.agentSlug,
    projectDir: input.projectDir ?? existing?.projectDir,
    recurrence,
    permission: input.permission ?? existing?.permission ?? 'edits',
    allowRules: mergeRules(input.allowRules ?? existing?.allowRules ?? []),
    enabled: input.enabled ?? existing?.enabled ?? true,
    origin: input.origin ?? existing?.origin ?? 'user',
    pluginName: input.pluginName ?? existing?.pluginName,
    createdAt: existing?.createdAt ?? Date.now(),
    lastRunAt: existing?.lastRunAt,
    lastRunId: existing?.lastRunId,
    nextRunAt: computeNextRun(recurrence),
  }

  if (existingIndex >= 0) schedules[existingIndex] = schedule
  else schedules.push(schedule)

  await writeSchedules(schedules)
  return schedule
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const schedules = await readSchedules()
  const next = schedules.filter(s => s.id !== id)
  if (next.length === schedules.length) return false
  await writeSchedules(next)
  return true
}

export async function markRan(id: string, runId: string): Promise<void> {
  const schedules = await readSchedules()
  const schedule = schedules.find(s => s.id === id)
  if (!schedule) return

  schedule.lastRunAt = Date.now()
  schedule.lastRunId = runId
  schedule.nextRunAt = computeNextRun(schedule.recurrence)
  await writeSchedules(schedules)
}
