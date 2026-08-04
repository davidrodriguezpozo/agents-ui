export interface WorktreeState {
  path: string
  exists: boolean
  branch: string | null
  changedFiles: number
  dirty: boolean
  ahead: number
}

export type SessionActivity = 'idle' | 'working' | 'awaiting-permission' | 'failed' | 'missing'

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
  /** Set when this continues a conversation started in the terminal. */
  adoptedAt?: number
  /** How much it may do without asking. Absent means `edits`. */
  trust?: TrustLevel
  /** Set once this session's branch has a pull request open. */
  prUrl?: string
  worktree: WorktreeState
  /** What the session is doing right now — see the sessions index endpoint. */
  activity: SessionActivity
  pendingPermissions: number
  lastRunId: string | null
  turnCount: number
  /** False when the session belongs to a repo other than the selected folder. */
  inCurrentProject: boolean
}

export type TrustLevel = 'readonly' | 'edits' | 'full'

/** What each level means for a session you are watching, in its own words. */
export const TRUST_CHOICES: { value: TrustLevel; label: string; hint: string }[] = [
  { value: 'readonly', label: 'Plan only', hint: 'Reads and proposes. Changes nothing at all.' },
  { value: 'edits', label: 'Edit files', hint: 'Writes files freely. Asks before anything riskier.' },
  { value: 'full', label: 'Auto', hint: 'Runs commands too, and never stops to ask. Only in a workspace you are happy to throw away.' },
]

export interface TranscriptMessage {
  role: 'user' | 'assistant'
  text: string
  at?: number
}

export interface TurnToolCall {
  id: string
  toolName: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
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
  /** What the turn did, recovered from its event log. */
  toolCalls?: TurnToolCall[]
}

/** What a worktree with no session could be restored into, and what it holds. */
export interface WorktreeRecovery {
  id: string
  title: string
  branch: string
  worktreePath: string
  sdkSessionId?: string
  turnCount: number
  exists: boolean
  /** Commits that exist nowhere else — what deleting it would cost. */
  unmergedCommits: number
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
  recovery: WorktreeRecovery | null
}

export interface PullRequestPreview {
  canOpen: boolean
  blockedReason?: string
  baseBranch: string
  branch: string
  commits: { sha: string; subject: string }[]
  uncommittedFiles: string[]
  files: string[]
  remote: string | null
  existingUrl?: string
  suggestedTitle: string
  suggestedBody: string
}

export interface MergePreview {
  canMerge: boolean
  blockedReason?: string
  targetBranch: string
  currentBranch: string
  repoClean: boolean
  commits: number
  uncommittedFiles: string[]
  conflicts: string[]
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

  /**
   * Start on work that already exists — a pull request or a branch. The server
   * decides which from what was pasted.
   */
  async function startFrom(ref: string) {
    const session = await $fetch<Session>('/api/sessions/from-existing', {
      method: 'POST',
      body: { ref },
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

  /** The terminal conversation an adopted session continues. History only. */
  async function fetchTranscript(id: string) {
    const result = await $fetch<{ messages: TranscriptMessage[] }>(
      `/api/sessions/${encodeURIComponent(id)}/transcript`,
    )
    return result.messages
  }

  /** Takes effect on the next turn — the SDK is told once, when a run starts. */
  async function setTrust(id: string, trust: TrustLevel) {
    return $fetch<Session>(`/api/sessions/${encodeURIComponent(id)}/trust`, {
      method: 'POST',
      body: { trust },
    })
  }

  async function fetchDiff(id: string) {
    return $fetch<{ files: DiffFile[]; patch: string }>(`/api/sessions/${encodeURIComponent(id)}/diff`)
  }

  async function previewPullRequest(id: string) {
    return $fetch<PullRequestPreview>(`/api/sessions/${encodeURIComponent(id)}/pr`)
  }

  /** Pushes the branch and opens the request — visible to everyone else. */
  async function openPullRequest(id: string, opts: {
    title: string
    body: string
    commitFirst?: boolean
    draft?: boolean
  }) {
    const result = await $fetch<{ url: string; committed: boolean }>(
      `/api/sessions/${encodeURIComponent(id)}/pr`,
      { method: 'POST', body: opts },
    )
    await fetchAll()
    return result
  }

  async function previewMerge(id: string) {
    return $fetch<MergePreview>(`/api/sessions/${encodeURIComponent(id)}/merge`)
  }

  async function merge(id: string, opts: { message?: string; commitFirst?: boolean } = {}) {
    const result = await $fetch<{ merged: boolean; commitsBrought: number; committedBeforeMerge: number }>(
      `/api/sessions/${encodeURIComponent(id)}/merge`,
      { method: 'POST', body: opts },
    )
    await fetchAll()
    return result
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
  const workingCount = computed(() => sessions.value.filter(s => s.activity === 'working').length)
  const needsYouCount = computed(() =>
    sessions.value.filter(s => s.activity === 'awaiting-permission').length
  )

  /** Sessions in other repositories, so they are not silently invisible. */
  const elsewhere = computed(() => sessions.value.filter(s => !s.inCurrentProject))
  const here = computed(() => sessions.value.filter(s => s.inCurrentProject))

  return {
    sessions,
    active,
    here,
    elsewhere,
    workingCount,
    needsYouCount,
    loading,
    fetchAll,
    create,
    startFrom,
    fetchOne,
    send,
    fetchTranscript,
    setTrust,
    previewPullRequest,
    openPullRequest,
    fetchDiff,
    previewMerge,
    merge,
    close,
  }
}

/** Worktrees as git reports them, including ones with no session behind them. */
export function useWorktrees() {
  const data = useState<{ repoDir: string | null; isRepo: boolean; root: string | null; home: string | null; worktrees: WorktreeEntry[] }>(
    'worktrees',
    () => ({ repoDir: null, isRepo: false, root: null, home: null, worktrees: [] }),
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

  async function recover(opts: { paths?: string[] } = {}) {
    const result = await $fetch<{ recovered: Session[]; skipped: { path: string; reason: string }[] }>(
      '/api/worktrees/recover',
      { method: 'POST', body: opts },
    )
    await fetchAll()
    return result
  }

  const orphans = computed(() => data.value.worktrees.filter(w => w.orphaned))

  /** Orphans whose directory is still there, so there is something to restore. */
  const restorable = computed(() => orphans.value.filter(w => w.recovery?.exists))

  return { data, orphans, restorable, fetchAll, prune, recover }
}
