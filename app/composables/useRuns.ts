import type { PermissionRequest, RunStats } from '~/types'

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type RunKind = 'command' | 'chat' | 'agent'
/** What set a run going. */
export type RunSource = 'ritual' | 'session' | 'agent' | 'command'
/** `attention` is the one that isn't a status: finished, but refused a tool. */
export type RunOutcomeFilter = 'running' | 'completed' | 'failed' | 'cancelled' | 'attention'

export interface RunQuery {
  limit?: number
  q?: string
  source?: RunSource
  outcome?: RunOutcomeFilter
}

export interface RunSummary {
  id: string
  kind: RunKind
  title: string
  invocation?: string
  agentSlug?: string
  status: RunStatus
  createdAt: number
  completedAt?: number
  durationMs?: number
  costUsd?: number
  preview: string
  error?: string
  needsAttention?: boolean
  deniedTools?: string[]
  suggestedRules?: string[]
  scheduleId?: string
  sessionId?: string
  source: RunSource
}

export interface RunToolCall {
  id: string
  toolName: string
  input: unknown
  result?: string
  isError?: boolean
}

export interface LiveRun {
  id: string
  status: RunStatus
  output: string
  thinking: string
  toolCalls: RunToolCall[]
  stats?: RunStats
  error?: string
  lastSeq: number
}

export interface StartRunBody {
  input: string
  kind?: RunKind
  title?: string
  invocation?: string
  agentSlug?: string
  projectDir?: string
  permissionMode?: string
  maxTurns?: number
  allowedTools?: string[]
}

function emptyRun(id: string): LiveRun {
  return { id, status: 'queued', output: '', thinking: '', toolCalls: [], lastSeq: -1 }
}

export function useRuns() {
  const runs = useState<RunSummary[]>('runs', () => [])
  const loading = useState('runsLoading', () => false)
  const live = useState<Record<string, LiveRun>>('live-runs', () => ({}))
  const permissions = usePermissionPrompts('runs')

  /**
   * Filtering is the server's job: the log is capped at `limit`, so narrowing
   * it here would only ever search the most recent page of a long history.
   */
  async function fetchRuns(query: RunQuery = {}) {
    loading.value = true
    try {
      runs.value = await $fetch<RunSummary[]>('/api/runs', {
        query: { limit: query.limit ?? 50, q: query.q || undefined, source: query.source, outcome: query.outcome },
      })
    } catch (e) {
      console.error('[useRuns] fetchRuns:', e)
    } finally {
      loading.value = false
    }
  }

  /** Start a run and return its id. The run continues regardless of this tab. */
  async function startRun(body: StartRunBody): Promise<string> {
    const { workingDir } = useWorkingDir()
    const result = await $fetch<{ id: string }>('/api/runs', {
      method: 'POST',
      body: { ...body, projectDir: body.projectDir ?? workingDir.value ?? undefined },
    })

    live.value[result.id] = emptyRun(result.id)
    return result.id
  }

  /**
   * Attach to a run and mirror it into reactive state. Safe to call on a run
   * that finished hours ago — the server replays from `after`.
   */
  async function attach(id: string, signal?: AbortSignal): Promise<void> {
    if (!live.value[id]) live.value[id] = emptyRun(id)

    const after = live.value[id]!.lastSeq
    const response = await $fetch<ReadableStream>(`/api/runs/${encodeURIComponent(id)}/stream`, {
      query: { after },
      responseType: 'stream',
      signal,
    })

    const reader = (response as unknown as ReadableStream).getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          apply(id, JSON.parse(line.slice(6)))
        } catch {
          // Skip malformed frames
        }
      }
    }
  }

  function apply(id: string, event: Record<string, unknown>) {
    const run = live.value[id]
    if (!run) return

    if (typeof event.seq === 'number') run.lastSeq = Math.max(run.lastSeq, event.seq)

    switch (event.type) {
      case 'status':
        run.status = event.status as RunStatus
        break
      case 'text':
        run.output += String(event.text ?? '')
        break
      case 'thinking':
        run.thinking += String(event.text ?? '')
        break
      case 'tool_use':
        run.toolCalls.push({
          id: String(event.id),
          toolName: String(event.toolName),
          input: event.input,
        })
        break
      case 'tool_result': {
        const call = run.toolCalls.find(t => t.id === String(event.id))
        if (call) {
          call.result = String(event.preview ?? '')
          call.isError = Boolean(event.isError)
        }
        break
      }
      case 'permission_request':
        permissions.add(event.request as PermissionRequest)
        break
      case 'permission_resolved':
        // Replays include prompts answered before this tab attached.
        permissions.resolve(String(event.id))
        break
      case 'result':
        // Authoritative — streamed deltas can be partial.
        run.output = String(event.text ?? run.output)
        run.stats = event.stats as RunStats
        break
      case 'error':
        run.error = String(event.message ?? 'Unknown error')
        break
      case 'done':
        run.status = event.status as RunStatus
        // A finished run has nothing left to approve.
        if (event.status !== 'running' && event.status !== 'queued') clearPromptsFor(id)
        break
    }
  }

  /** Prompts are keyed by run id, so a finished run's can be dropped in one go. */
  function clearPromptsFor(id: string) {
    for (const request of [...permissions.pending.value]) {
      if (request.ownerId === id) permissions.resolve(request.id)
    }
  }

  function promptsFor(id: string) {
    return computed(() => permissions.pending.value.filter(p => p.ownerId === id))
  }

  async function cancelRun(id: string) {
    await $fetch(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
    const run = live.value[id]
    if (run) run.status = 'cancelled'
    clearPromptsFor(id)
  }

  const activeCount = computed(() =>
    Object.values(live.value).filter(r => r.status === 'running' || r.status === 'queued').length
  )

  const pendingPermissions = computed(() => permissions.pending.value)

  return {
    runs,
    loading,
    live,
    activeCount,
    fetchRuns,
    startRun,
    attach,
    cancelRun,
    pendingPermissions,
    promptsFor,
    isAnsweringPermission: permissions.isAnswering,
    answerPermission: permissions.answer,
  }
}
