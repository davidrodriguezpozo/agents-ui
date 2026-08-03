export interface WorktreeState {
  path: string
  exists: boolean
  branch: string | null
  changedFiles: number
  dirty: boolean
  ahead: number
}

export interface Session {
  id: string
  title: string
  repoDir: string
  worktreePath: string
  branch: string
  baseBranch: string
  baseSha: string
  status: 'idle' | 'running' | 'archived'
  agentSlug?: string
  runIds: string[]
  createdAt: number
  updatedAt: number
  worktreeRemovedAt?: number
  worktree: WorktreeState
}

export interface SessionTurn {
  id: string
  input: string
  output: string
  status: string
  createdAt: number
  completedAt?: number
  costUsd?: number
  error?: string
}

export interface WorktreeEntry {
  path: string
  branch: string | null
  head: string | null
  prunable: boolean
  isMain: boolean
  sessionId: string | null
  sessionTitle: string | null
  orphaned: boolean
}

export interface DiffFile {
  path: string
  added: number
  removed: number
  staged: boolean
}

export function useSessions() {
  const sessions = useState<Session[]>('sessions', () => [])
  const loading = useState('sessionsLoading', () => false)

  async function fetchAll() {
    loading.value = true
    try {
      sessions.value = await $fetch<Session[]>('/api/sessions')
    } catch (e) {
      console.error('[useSessions] fetchAll:', e)
    } finally {
      loading.value = false
    }
  }

  async function create(title: string, agentSlug?: string) {
    const session = await $fetch<Session>('/api/sessions', {
      method: 'POST',
      body: { title, agentSlug },
    })
    await fetchAll()
    return session
  }

  async function fetchOne(id: string) {
    return $fetch<Session & { turns: SessionTurn[] }>(`/api/sessions/${encodeURIComponent(id)}`)
  }

  /** Returns the run id, which the caller attaches to for live output. */
  async function send(id: string, input: string): Promise<string> {
    const result = await $fetch<{ runId: string }>(`/api/sessions/${encodeURIComponent(id)}/message`, {
      method: 'POST',
      body: { input },
    })
    return result.runId
  }

  async function fetchDiff(id: string) {
    return $fetch<{ files: DiffFile[]; patch: string }>(`/api/sessions/${encodeURIComponent(id)}/diff`)
  }

  async function close(id: string, opts: { force?: boolean; keepBranch?: boolean } = {}) {
    const query = new URLSearchParams()
    if (opts.force) query.set('force', '1')
    if (opts.keepBranch) query.set('keepBranch', '1')

    const result = await $fetch<{ closed: boolean; branchKept: string | null }>(
      `/api/sessions/${encodeURIComponent(id)}?${query}`,
      { method: 'DELETE' },
    )
    await fetchAll()
    return result
  }

  const active = computed(() => sessions.value.filter(s => s.status !== 'archived'))
  const runningCount = computed(() => sessions.value.filter(s => s.status === 'running').length)

  return { sessions, active, runningCount, loading, fetchAll, create, fetchOne, send, fetchDiff, close }
}

/** Worktrees as git reports them, including ones with no session behind them. */
export function useWorktrees() {
  const data = useState<{ repoDir: string | null; isRepo: boolean; root: string | null; worktrees: WorktreeEntry[] }>(
    'worktrees',
    () => ({ repoDir: null, isRepo: false, root: null, worktrees: [] }),
  )

  async function fetchAll() {
    try {
      data.value = await $fetch('/api/worktrees')
    } catch (e) {
      console.error('[useWorktrees] fetchAll:', e)
    }
  }

  async function prune(opts: { paths?: string[]; force?: boolean } = {}) {
    const result = await $fetch<{ removed: string[]; failed: { path: string; reason: string }[] }>(
      '/api/worktrees/prune',
      { method: 'POST', body: opts },
    )
    await fetchAll()
    return result
  }

  const orphans = computed(() => data.value.worktrees.filter(w => w.orphaned))

  return { data, orphans, fetchAll, prune }
}
