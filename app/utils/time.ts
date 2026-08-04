/** How long ago something happened, in the shape a list column wants. */
export function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
