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

  async function fetchAll() {
    loading.value = true
    try {
      const [mine, theirs] = await Promise.all([
        $fetch<Schedule[]>('/api/schedules'),
        $fetch<SuggestedRitual[]>('/api/schedules/suggested').catch(() => []),
      ])
      schedules.value = mine
      suggested.value = theirs
    } catch (e) {
      console.error('[useSchedules] fetchAll:', e)
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

  return { schedules, suggested, loading, fetchAll, save, remove, setEnabled, adopt }
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
