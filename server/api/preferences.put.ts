import {
  savePreferences,
  sanitisePullActions,
  type NotificationPreferences,
  type PullActionCommands,
} from '../utils/preferences'

const KEYS: (keyof NotificationPreferences)[] = ['enabled', 'needsYou', 'failed', 'finished']

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    notifications?: Partial<NotificationPreferences>
    summariseSessions?: boolean
    repairAttempts?: number
    maxTurns?: number
    maxConcurrentRuns?: number
    pauseOnQuotaWarning?: boolean
    dailyCapUsd?: number
    runCapUsd?: number
    pullActions?: Partial<PullActionCommands>
  }>(event)

  // Only the switches, and only as booleans — nothing else belongs in here.
  const patch: Partial<NotificationPreferences> & {
    summariseSessions?: boolean
    repairAttempts?: number
    maxTurns?: number
    maxConcurrentRuns?: number
    pauseOnQuotaWarning?: boolean
    dailyCapUsd?: number
    runCapUsd?: number
    pullActions?: Partial<PullActionCommands>
  } = {}
  for (const key of KEYS) {
    const value = body?.notifications?.[key]
    if (typeof value === 'boolean') patch[key] = value
  }

  if (typeof body?.summariseSessions === 'boolean') {
    patch.summariseSessions = body.summariseSessions
  }

  if (typeof body?.pauseOnQuotaWarning === 'boolean') {
    patch.pauseOnQuotaWarning = body.pauseOnQuotaWarning
  }

  // 0 is meaningful — it is how a limit is turned off — so these are only
  // ignored when absent, not when falsy.
  if (typeof body?.dailyCapUsd === 'number') patch.dailyCapUsd = body.dailyCapUsd
  if (typeof body?.runCapUsd === 'number') patch.runCapUsd = body.runCapUsd
  // Same reasoning: 0 is how this is turned off, so absent is the only skip.
  if (typeof body?.repairAttempts === 'number') patch.repairAttempts = body.repairAttempts
  // 0 is how this returns to the built-in default, so absent is the only skip.
  if (typeof body?.maxTurns === 'number') patch.maxTurns = body.maxTurns
  if (typeof body?.maxConcurrentRuns === 'number') patch.maxConcurrentRuns = body.maxConcurrentRuns

  // A partial is expected — the settings page sends only the action it changed,
  // and `savePreferences` merges it over the three it did not. Sanitised here so
  // only the keys the client actually sent are forwarded, each a trimmed string.
  if (body?.pullActions && typeof body.pullActions === 'object') {
    const sent = body.pullActions as Record<string, unknown>
    const full = sanitisePullActions(sent)
    const only: Partial<PullActionCommands> = {}
    for (const key of Object.keys(full) as (keyof PullActionCommands)[]) {
      if (key in sent) only[key] = full[key]
    }
    if (Object.keys(only).length) patch.pullActions = only
  }

  return savePreferences(patch)
})
