import { errorMessage } from '~/utils/errors'

export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'stopped'

export interface WorkflowStepRun {
  stepId: string
  agentSlug?: string
  runId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  output: string
  error?: string
  costUsd?: number
  durationMs?: number
}

export interface WorkflowRun {
  id: string
  workflowSlug: string
  title: string
  input: string
  projectDir?: string
  status: WorkflowRunStatus
  steps: WorkflowStepRun[]
  currentStep: number
  error?: string
  startedAt: number
  endedAt?: number
  /** Joined from the step runs, and only present in history. */
  costUsd?: number
  durationMs?: number
}

/**
 * Watching a workflow run.
 *
 * Polled rather than streamed, deliberately. A workflow is several runs and
 * would mean several streams, and this app has already been taken down once by
 * connections that outlived the page that opened them. A poll costs one small
 * request every second and a half, cannot leak, and stops on its own when the
 * run does.
 *
 * The run itself is on the server, so none of this is load-bearing: closing
 * the tab loses the view, not the work, and reopening picks the same run back
 * up wherever it has got to.
 */
export function useWorkflowRun() {
  const run = useState<WorkflowRun | null>('workflow-run', () => null)
  const starting = useState('workflow-run-starting', () => false)
  const error = useState<string | null>('workflow-run-error', () => null)

  let timer: ReturnType<typeof setTimeout> | null = null

  const isRunning = computed(() => run.value?.status === 'running')

  function stopPolling() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  async function refresh(id: string) {
    try {
      run.value = await $fetch<WorkflowRun>(`/api/workflow-runs/${encodeURIComponent(id)}`)
    } catch (e) {
      error.value = errorMessage(e, 'Lost track of that run.')
      stopPolling()
      return
    }

    // Chained rather than on an interval, so a slow response cannot stack
    // requests up behind itself.
    if (run.value?.status === 'running') {
      timer = setTimeout(() => void refresh(id), 1500)
    } else {
      stopPolling()
    }
  }

  /** Pick up a run already in flight — after a reload, or on coming back. */
  async function watch(id: string) {
    stopPolling()
    error.value = null
    await refresh(id)
  }

  async function start(slug: string, input: string, projectDir?: string) {
    starting.value = true
    error.value = null
    try {
      const result = await $fetch<{ run: WorkflowRun }>(
        `/api/workflows/${encodeURIComponent(slug)}/run`,
        { method: 'POST', body: { input, projectDir } },
      )
      run.value = result.run
      await watch(result.run.id)
      return result.run
    } finally {
      starting.value = false
    }
  }

  async function stop() {
    if (!run.value) return
    await $fetch(`/api/workflow-runs/${encodeURIComponent(run.value.id)}/stop`, { method: 'POST' })
    await refresh(run.value.id)
  }

  async function history(slug: string) {
    const result = await $fetch<{ runs: WorkflowRun[] }>(
      `/api/workflows/${encodeURIComponent(slug)}/runs`,
    )
    return result.runs
  }

  /** Nothing here outlives the page that opened it. */
  onScopeDispose(stopPolling)

  return { run, isRunning, starting, error, start, watch, stop, history, stopPolling }
}
