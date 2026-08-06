import { errorMessage } from '~/utils/errors'

export type McpStatus = 'connected' | 'needs-auth' | 'failed' | 'pending' | 'unknown'

export interface McpServer {
  name: string
  /** URL, or the command for a stdio server. */
  target: string
  transport?: string
  status: McpStatus
  /** Why it is not working. Can be long, and can contain a page of HTML. */
  detail?: string
  origin: 'plugin' | 'claude.ai' | 'project'
  pluginName?: string
}

/**
 * What MCP servers this machine has, and whether they work.
 *
 * Read-only for now, and honest about it: adding and editing them still means
 * `claude mcp add` or a `.mcp.json`. Knowing which of the ones you already have
 * are actually answering is the part that was missing — a configured server and
 * a working one turn out to be quite different things.
 */
export function useMcp() {
  const servers = useState<McpServer[]>('mcp-servers', () => [])
  const cwd = useState<string | null>('mcp-cwd', () => null)
  const loading = useState('mcp-loading', () => false)
  const error = useState<string | null>('mcp-error', () => null)
  const loaded = useState('mcp-loaded', () => false)

  async function load(refresh = false) {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{ cwd: string | null; servers: McpServer[] }>('/api/mcp', {
        query: refresh ? { refresh: '1' } : undefined,
      })
      servers.value = result.servers
      cwd.value = result.cwd
      loaded.value = true
    } catch (e) {
      error.value = errorMessage(e, 'Could not read your MCP servers.')
    } finally {
      loading.value = false
    }
  }

  /** Working, then the ones you could do something about, then the rest. */
  const RANK: Record<McpStatus, number> = {
    failed: 0, 'needs-auth': 1, pending: 2, unknown: 3, connected: 4,
  }

  const sorted = computed(() =>
    [...servers.value].sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name)),
  )

  const broken = computed(() => servers.value.filter(s => s.status === 'failed' || s.status === 'needs-auth').length)

  return { servers, sorted, cwd, loading, error, loaded, broken, load }
}
