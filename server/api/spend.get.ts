import { runsSince } from '../utils/runStore'
import { readSessions } from '../utils/sessions'
import { summarizeSpend, type SideCost } from '../utils/spend'

export default defineEventHandler(async (event) => {
  const days = Math.max(1, Math.min(Number(getQuery(event).days) || 30, 365))
  const now = Date.now()
  // From the start of the earliest day, so "7 days" means seven whole days.
  const since = new Date(now - (days - 1) * 86_400_000).setHours(0, 0, 0, 0)

  // Summaries are model calls that never enter the run log, so without this
  // the total would quietly exclude them. Only the newest per session survives
  // — an earlier one was overwritten and its cost is not recoverable — so this
  // under-reports slightly rather than inventing a figure.
  const side: SideCost[] = (await readSessions())
    .map(session => session.summary)
    .filter((s): s is NonNullable<typeof s> => Boolean(s && s.costUsd > 0 && s.at >= since))
    .map(s => ({ source: 'summary' as const, costUsd: s.costUsd, at: s.at }))

  return { days, ...summarizeSpend(await runsSince(since), days, now, side) }
})
