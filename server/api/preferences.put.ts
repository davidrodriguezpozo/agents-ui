import { savePreferences, type NotificationPreferences } from '../utils/preferences'

const KEYS: (keyof NotificationPreferences)[] = ['enabled', 'needsYou', 'failed', 'finished']

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    notifications?: Partial<NotificationPreferences>
    summariseSessions?: boolean
    dailyCapUsd?: number
    runCapUsd?: number
  }>(event)

  // Only the switches, and only as booleans — nothing else belongs in here.
  const patch: Partial<NotificationPreferences> & {
    summariseSessions?: boolean
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

  return savePreferences(patch)
})
