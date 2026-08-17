/** How long ago something happened, in the shape a list column wants. */
export function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * How long something has been sitting, when that is the point rather than when
 * it happened.
 *
 * `relativeTime` answers "when", and past a day it answers it as a date —
 * "Apr 20", which is a fact you have to do arithmetic on before it means
 * anything. For a row whose whole news is that nothing has happened, the
 * duration *is* the news, so it is given directly.
 */
export function agedFor(ts: number, now = Date.now()): string {
  const days = Math.floor((now - ts) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 60) return `${days}d`
  const months = Math.round(days / 30)
  return months < 24 ? `${months}mo` : `${Math.round(days / 365)}y`
}

export function formatDuration(ms?: number): string | null {
  if (!ms) return null
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}m`
}

/** Sub-cent runs are common, so two decimals would read as free. */
export function formatCost(usd?: number): string | null {
  if (!usd) return null
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}
