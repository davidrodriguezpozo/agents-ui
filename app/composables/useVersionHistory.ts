interface VersionSnapshot {
  timestamp: number
  frontmatter: Record<string, unknown>
  body: string
}

const HISTORY_PREFIX = 'agents-ui-history:'
const MAX_VERSIONS = 20

export function useVersionHistory(key: string) {
  const storageKey = HISTORY_PREFIX + key
  const versions = ref<VersionSnapshot[]>([])

  function load() {
    if (!import.meta.client) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) versions.value = JSON.parse(raw)
    } catch {
      versions.value = []
    }
  }

  function saveVersion(frontmatter: object, body: string) {
    if (!import.meta.client) return
    const snapshot: VersionSnapshot = {
      timestamp: Date.now(),
      frontmatter: frontmatter as Record<string, unknown>,
      body,
    }
    // Don't save if identical to last version
    const last = versions.value[0]
    if (last
      && JSON.stringify(last.frontmatter) === JSON.stringify(snapshot.frontmatter)
      && last.body === snapshot.body) {
      return
    }
    versions.value.unshift(snapshot)
    if (versions.value.length > MAX_VERSIONS) {
      versions.value = versions.value.slice(0, MAX_VERSIONS)
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(versions.value))
    } catch {
      // localStorage full
    }
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    if (isToday) return `Today ${time}`
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${time}`
  }

  function simpleDiff(oldText: string, newText: string): { added: number; removed: number } {
    const oldLines = oldText.split('\n')
    const newLines = newText.split('\n')
    const oldSet = new Set(oldLines)
    const newSet = new Set(newLines)
    let added = 0
    let removed = 0
    for (const line of newLines) {
      if (!oldSet.has(line)) added++
    }
    for (const line of oldLines) {
      if (!newSet.has(line)) removed++
    }
    return { added, removed }
  }

  // Load on init
  load()

  return {
    versions: readonly(versions),
    saveVersion,
    formatTime,
    simpleDiff,
  }
}
