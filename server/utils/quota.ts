import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'

/**
 * How much of your Claude subscription is left.
 *
 * The spend page counts dollars, which is the right unit for exactly one kind
 * of user: somebody paying per token through the API. Everyone on Pro or Max
 * pays a flat monthly fee and is never billed for a run at all — for them the
 * dollar figures are notional, and the thing that will actually stop their work
 * at 09:00 is the rate limit, which nothing here has ever mentioned.
 *
 * The SDK emits a `rate_limit_event` whenever this changes, so it costs nothing
 * to collect: it arrives during runs that were happening anyway.
 *
 * Two things about the real payload, both established by watching one rather
 * than by reading about it:
 *
 * - **`utilization` is usually absent.** It appears only when there is
 *   something to report. A limit expressed as "stop at 80% of the week" —
 *   which is what this was originally going to be — would therefore have had
 *   nothing to read most of the time, and would have silently never fired.
 * - **`resetsAt` is in seconds**, not milliseconds. Ten digits where the rest
 *   of this codebase uses thirteen. Handing it to `new Date()` unconverted
 *   dates the reset to January 1970.
 *
 * So the limit here is built on `status`, which is always present and is
 * Anthropic's own judgement of how close you are, rather than on a percentage
 * we would have to interpret.
 */

export type QuotaStatus = 'allowed' | 'allowed_warning' | 'rejected'

export type QuotaWindow
  = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage'

export interface QuotaInfo {
  status: QuotaStatus
  /** Seconds since the epoch, as the SDK sends it. Not milliseconds. */
  resetsAt?: number
  rateLimitType?: QuotaWindow
  /** Absent more often than not — never rely on it being here. */
  utilization?: number
  /** When we heard this, in milliseconds, so staleness can be judged. */
  observedAt: number
}

/**
 * Beyond this, what we last heard is too old to show as current. A five-hour
 * window can turn over entirely in that time, and a stale bar claiming you are
 * nearly out is worse than no bar.
 */
export const QUOTA_STALE_AFTER_MS = 6 * 60 * 60_000

export const quotaStore = defineJsonStore<QuotaInfo | null>({
  label: 'rate limit',
  path: () => join(getClaudeDir(), 'agents-ui', 'quota.json'),
  empty: () => null,
  decode: parsed => parsed?.quota ?? null,
  encode: quota => ({ version: 1, quota }),
})

/** Seconds to milliseconds, for the one field that arrives in seconds. */
export function resetsAtMs(info: Pick<QuotaInfo, 'resetsAt'>): number | undefined {
  return typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : undefined
}

export function isStale(info: QuotaInfo | null, now = Date.now()): boolean {
  if (!info) return true
  return now - info.observedAt > QUOTA_STALE_AFTER_MS
}

/** Never throws: not knowing your rate limit must not stop a run. */
export async function readQuota(): Promise<QuotaInfo | null> {
  try {
    return await quotaStore.read()
  } catch {
    return null
  }
}

/**
 * Record what the SDK just told us. Only the fields we understand are kept —
 * this is written on every run, so it is not the place to hoard a payload.
 */
export async function recordQuota(
  info: { status?: string; resetsAt?: number; rateLimitType?: string; utilization?: number },
  now = Date.now(),
): Promise<void> {
  const status = info.status
  if (status !== 'allowed' && status !== 'allowed_warning' && status !== 'rejected') return

  // `write` rather than `update`: this replaces the value wholesale, and
  // `update` writes back the object it handed you, which cannot express
  // replacing a value that is not a container. The write is atomic either way.
  await quotaStore.write({
    status,
    resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt : undefined,
    rateLimitType: info.rateLimitType as QuotaWindow | undefined,
    utilization: typeof info.utilization === 'number' ? info.utilization : undefined,
    observedAt: now,
  })
}

const WINDOW_LABELS: Record<QuotaWindow, string> = {
  five_hour: 'five-hour',
  seven_day: 'weekly',
  seven_day_opus: 'weekly Opus',
  seven_day_sonnet: 'weekly Sonnet',
  overage: 'overage',
}

export function describeWindow(window: QuotaWindow | undefined): string {
  return window ? WINDOW_LABELS[window] ?? window : 'usage'
}

/**
 * Whether unattended work should wait.
 *
 * Only ever consulted for work nobody asked for right now — a ritual, a repair
 * turn, a landing step. A turn you typed is never held back over this: you can
 * see the state of your own account, and being told "no" by your own tool for
 * something you deliberately started is the wrong side of helpful.
 */
export function quotaBlocks(info: QuotaInfo | null, now = Date.now()): boolean {
  if (!info || isStale(info, now)) return false
  return info.status === 'allowed_warning' || info.status === 'rejected'
}

export function quotaReason(info: QuotaInfo): string {
  const window = describeWindow(info.rateLimitType)
  const resets = resetsAtMs(info)
  const when = resets ? ` It resets ${new Date(resets).toLocaleString()}.` : ''

  return info.status === 'rejected'
    ? `Your ${window} limit is used up, so this was skipped rather than run into a refusal.${when}`
    : `You are close to your ${window} limit, so unattended work is being held back to leave `
      + `room for what you do yourself.${when}`
}
