import { savePreferences, type NotificationPreferences } from '../utils/preferences'

const KEYS: (keyof NotificationPreferences)[] = ['enabled', 'needsYou', 'failed', 'finished']

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    notifications?: Partial<NotificationPreferences>
    summariseSessions?: boolean
    repairAttempts?: number
    maxTurns?: number
    maxConcurrentRuns?: number
    dailyCapUsd?: number
    runCapUsd?: number
  }>(event)

  // Only the switches, and only as booleans — nothing else belongs in here.
  const patch: Partial<NotificationPreferences> & {
    summariseSessions?: boolean
    repairAttempts?: number
    maxTurns?: number
    maxConcurrentRuns?: number
    dailyCapUsd?: number
    runCapUsd?: number
  } = {}
  for (const key of KEYS) {
    const value = body?.notifications?.[key]
    if (typeof value === 'boolean') patch[key] = value
  }

  if (typeof body?.summariseSessions === 'boolean') {
    patch.summariseSessions = body.summariseSessions
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

  return savePreferences(patch)
})
