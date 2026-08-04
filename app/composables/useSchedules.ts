import { errorMessage } from '~/utils/errors'

export interface Recurrence {
  hour: number
  minute: number
  /** Days of the week, Sunday = 0. Empty means every day. */
  days: number[]
}

export type SchedulePermission = 'readonly' | 'edits' | 'full'

export interface Schedule {
  id: string
  title: string
  input: string
  invocation?: string
  agentSlug?: string
  projectDir?: string
  recurrence: Recurrence
  permission: SchedulePermission
  /** Permanent permission rules, e.g. `Bash(gh:*)`. */
  allowRules?: string[]
  enabled: boolean
  origin: 'user' | 'team'
  pluginName?: string
  createdAt: number
  lastRunAt?: number
  lastRunId?: string
  nextRunAt?: number
  /** Human-readable recurrence, built server-side. */
  description: string
}

export type RitualOutcome = 'ok' | 'blocked' | 'failed' | 'stopped' | 'running'

export interface RitualRun {
  id: string
  at: number
  outcome: RitualOutcome
  durationMs?: number
  costUsd?: number
  deniedTools?: string[]
  suggestedRules?: string[]
  error?: string
  preview: string
}

export interface RitualHistory {
  runs: RitualRun[]
  /** Most recent runs in a row that came to nothing. */
  failingStreak: number
  lastOkAt?: number
}

export interface SuggestedRitual {
  command: string
  title: string
  description: string
  recurrence: Recurrence
  recurrenceLabel: string
  recommended: boolean
  pluginName: string
  alreadyAdded: boolean
}

export function useSchedules() {
  const schedules = useState<Schedule[]>('schedules', () => [])
  const suggested = useState<SuggestedRitual[]>('suggested-rituals', () => [])
  const loading = useState('schedulesLoading', () => false)
  /**
   * Kept rather than swallowed. If the rituals cannot be read, an empty list
   * renders as "you have no rituals" — the same lie the storage layer refuses
   * to tell, and the one that gets someone to recreate work they still have.
   */
  const loadError = useState<string | null>('schedulesError', () => null)
  /** What each ritual has been doing, keyed by ritual id. */
  const histories = useState<Record<string, RitualHistory>>('ritual-histories', () => ({}))

  async function fetchAll() {
    loading.value = true
    try {
      const [mine, theirs, history] = await Promise.all([
        $fetch<Schedule[]>('/api/schedules'),
        $fetch<SuggestedRitual[]>('/api/schedules/suggested').catch(() => []),
        // History is context, not the rituals themselves — losing it must not
        // take the page down with it.
        $fetch<Record<string, RitualHistory>>('/api/schedules/history').catch(() => ({})),
      ])
      schedules.value = mine
      suggested.value = theirs
      histories.value = history
      loadError.value = null
    } catch (e) {
      console.error('[useSchedules] fetchAll:', e)
      loadError.value = errorMessage(e)
    } finally {
      loading.value = false
    }
  }

  async function save(schedule: Partial<Schedule>): Promise<Schedule> {
    const saved = await $fetch<Schedule>('/api/schedules', { method: 'POST', body: schedule })
    const idx = schedules.value.findIndex(s => s.id === saved.id)
    if (idx >= 0) schedules.value[idx] = saved
    else schedules.value.push(saved)
    return saved
  }

  async function remove(id: string) {
    await $fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' })
    schedules.value = schedules.value.filter(s => s.id !== id)
  }

  async function setEnabled(schedule: Schedule, enabled: boolean) {
    return save({ ...schedule, enabled })
  }

  /** Turn a team lead's suggestion into one of this person's own rituals. */
  async function adopt(ritual: SuggestedRitual) {
    const saved = await save({
      title: ritual.title,
      input: ritual.command,
      invocation: ritual.command,
      recurrence: ritual.recurrence,
      permission: 'edits',
      origin: 'team',
      pluginName: ritual.pluginName,
      enabled: true,
    })
    const match = suggested.value.find(s => s.command === ritual.command)
    if (match) match.alreadyAdded = true
    return saved
  }

  /** Grant a ritual the rules a run turned out to need. */
  async function allowRules(id: string, add: string[]) {
    const saved = await $fetch<Schedule>(`/api/schedules/${encodeURIComponent(id)}/allow`, {
      method: 'POST',
      body: { add },
    })
    const idx = schedules.value.findIndex(s => s.id === saved.id)
    if (idx >= 0) schedules.value[idx] = saved
    return saved
  }

  async function revokeRule(id: string, rule: string) {
    const saved = await $fetch<Schedule>(`/api/schedules/${encodeURIComponent(id)}/allow`, {
      method: 'POST',
      body: { remove: rule },
    })
    const idx = schedules.value.findIndex(s => s.id === saved.id)
    if (idx >= 0) schedules.value[idx] = saved
    return saved
  }

  function historyFor(id: string): RitualHistory {
    return histories.value[id] ?? { runs: [], failingStreak: 0 }
  }

  return {
    schedules,
    suggested,
    loading,
    loadError,
    histories,
    historyFor,
    fetchAll,
    save,
    remove,
    setEnabled,
    adopt,
    allowRules,
    revokeRule,
  }
}

export const PERMISSION_CHOICES: {
  value: SchedulePermission
  label: string
  hint: string
}[] = [
  {
    value: 'readonly',
    label: 'Look only',
    hint: 'Reads and reports. Changes nothing. Safest.',
  },
  {
    value: 'edits',
    label: 'Read and write files',
    hint: 'Can edit files. Stops if it needs anything riskier.',
  },
  {
    value: 'full',
    label: 'Anything it needs',
    hint: 'Includes running commands. Never stops to ask — only for rituals you trust.',
  },
]

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS = [1, 2, 3, 4, 5]
