import { errorMessage } from '~/utils/errors'

export interface InboxItem {
  id: string
  title: string
  url: string
  why: string
}

export interface InboxSourceReading {
  key: string
  label: string
  /** The MCP server it needs, for explaining why it cannot run. */
  requires: string
  icon: string
  items: InboxItem[]
  checkedAt?: number
  costUsd?: number
  durationMs?: number
  error?: string
  projectDir?: string
}

/**
 * Work waiting for you somewhere that is not this machine.
 *
 * Read on every page load because it is a file, and refreshed only when asked
 * because it is not. A real Notion refresh on this machine took 82 seconds and
 * cost $1.48 — on a fifteen-minute poll that is $142 a day, which is why nothing
 * here polls and why the cost of the last one is on screen.
 */
export function useInbox() {
  const sources = useState<InboxSourceReading[]>('inbox', () => [])
  const loading = useState('inbox-loading', () => false)
  const refreshing = useState<string | null>('inbox-refreshing', () => null)

  async function load() {
    loading.value = true
    try {
      const result = await $fetch<{ sources: InboxSourceReading[] }>('/api/inbox')
      sources.value = result.sources
    } catch {
      // A source that cannot be read is not worth breaking the page over; the
      // queue simply has one fewer input.
    } finally {
      loading.value = false
    }
  }

  /**
   * Go and look again. Returns the reason it could not, so the caller can say so
   * — this is the one action in the app that can cost a dollar, and a refusal
   * has to be legible rather than silent.
   */
  async function refresh(key: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    refreshing.value = key
    try {
      await $fetch(`/api/inbox/refresh`, { method: 'POST', body: { source: key } })
      await load()
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: errorMessage(e, 'The refresh did not finish.') }
    } finally {
      refreshing.value = null
    }
  }

  async function dismiss(key: string, id: string) {
    await $fetch('/api/inbox/dismiss', { method: 'POST', body: { source: key, id } })
    await load()
  }

  const items = computed(() =>
    sources.value.flatMap(source => source.items.map(item => ({ source, item }))),
  )

  return { sources, items, loading, refreshing, load, refresh, dismiss }
}
