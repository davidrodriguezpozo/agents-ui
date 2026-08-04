import { runsSince } from '../utils/runStore'
import { summarizeSpend } from '../utils/spend'

export default defineEventHandler(async (event) => {
  const days = Math.max(1, Math.min(Number(getQuery(event).days) || 30, 365))
  const now = Date.now()
  // From the start of the earliest day, so "7 days" means seven whole days.
  const since = new Date(now - (days - 1) * 86_400_000).setHours(0, 0, 0, 0)

  return { days, ...summarizeSpend(await runsSince(since), days, now) }
})
