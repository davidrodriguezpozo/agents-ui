import { savePreferences, type NotificationPreferences } from '../utils/preferences'

const KEYS: (keyof NotificationPreferences)[] = ['enabled', 'needsYou', 'failed', 'finished']

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    notifications?: Partial<NotificationPreferences>
    summariseSessions?: boolean
  }>(event)

  // Only the switches, and only as booleans — nothing else belongs in here.
  const patch: Partial<NotificationPreferences> & { summariseSessions?: boolean } = {}
  for (const key of KEYS) {
    const value = body?.notifications?.[key]
    if (typeof value === 'boolean') patch[key] = value
  }

  if (typeof body?.summariseSessions === 'boolean') {
    patch.summariseSessions = body.summariseSessions
  }

  return savePreferences(patch)
})
