import { describeWindow, isStale, readQuota, resetsAtMs } from '../utils/quota'

/**
 * What is left of the subscription, as last heard.
 *
 * Nothing is fetched here — the figure arrives on the SDK's own event during
 * runs that were happening anyway, so this only reports what was collected.
 * That means it can be absent (nothing has run yet) or stale, and both are said
 * plainly rather than dressed up as a current reading.
 */
export default defineEventHandler(async () => {
  const quota = await readQuota()
  if (!quota) return { known: false as const }

  return {
    known: true as const,
    status: quota.status,
    window: describeWindow(quota.rateLimitType),
    rateLimitType: quota.rateLimitType ?? null,
    // Converted here rather than in the page: it arrives in seconds, and every
    // other time in this app is milliseconds.
    resetsAt: resetsAtMs(quota) ?? null,
    utilization: quota.utilization ?? null,
    observedAt: quota.observedAt,
    stale: isStale(quota),
  }
})
