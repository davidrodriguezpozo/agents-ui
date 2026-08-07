export type LandingOutcome =
  | 'merged' | 'checks-failed' | 'conflicts' | 'update-failed' | 'no-checks' | 'refused'

export interface LandingStep {
  sessionId: string
  title: string
  need: 'ready' | 'update' | 'check' | 'blocked'
  outcome?: LandingOutcome
  detail?: string
  startedAt: number
  endedAt?: number
}

export interface LandingRun {
  id: string
  repoDir: string
  baseBranch: string
  status: 'running' | 'completed' | 'stopped'
  steps: LandingStep[]
  skipped: { sessionId: string; title: string; reason: string }[]
  error?: string
  summary?: string
  startedAt: number
  endedAt?: number
}

/**
 * Landing finished sessions into the base branch.
 *
 * Polled rather than streamed. A landing spends nearly all of its time inside
 * somebody's test suite, so there is no stream of events to follow — the
 * interesting moments are a step starting and a step ending, minutes apart,
 * and a request every couple of seconds covers that with nothing to maintain.
 */
export function useLanding() {
  const run = useState<LandingRun | null>('landing-run', () => null)
  const starting = ref(false)

  const active = computed(() => run.value?.status === 'running')

  let poll: ReturnType<typeof setInterval> | null = null

  async function refresh() {
    try {
      const result = await $fetch<{ runs: LandingRun[] }>('/api/landing')
      run.value = result.runs[0] ?? null
    } catch {
      // A landing that cannot be read is still landing; the next tick may work.
    }
  }

  /** Follow while it is going, and stop as soon as it is not. */
  function watch() {
    if (poll) return
    poll = setInterval(async () => {
      await refresh()
      if (!active.value) stop()
    }, 2000)
  }

  function stop() {
    if (poll) clearInterval(poll)
    poll = null
  }

  async function start() {
    starting.value = true
    try {
      run.value = await $fetch<LandingRun>('/api/landing', { method: 'POST' })
      watch()
      return run.value
    } finally {
      starting.value = false
    }
  }

  onScopeDispose(stop)

  return { run, active, starting, start, refresh, watch, stop }
}

/** What each ending is called, and whether it is a good one. */
export const LANDING_OUTCOMES: Record<LandingOutcome, { label: string; good: boolean }> = {
  'merged': { label: 'Merged', good: true },
  'checks-failed': { label: 'Checks failed', good: false },
  'conflicts': { label: 'Would conflict', good: false },
  'update-failed': { label: 'Could not update', good: false },
  'no-checks': { label: 'Nothing to verify it', good: false },
  'refused': { label: 'Refused', good: false },
}
