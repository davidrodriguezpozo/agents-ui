export type LandingOutcome =
  | 'merged' | 'already-landed' | 'checks-failed' | 'conflicts'
  | 'update-failed' | 'no-checks' | 'refused'

export interface LandingStep {
  sessionId: string
  title: string
  need: 'ready' | 'update' | 'check' | 'blocked'
  outcome?: LandingOutcome
  detail?: string
  startedAt: number
  endedAt?: number
}

/** Re-exported so the train's drawing code has one place to import from. */
export type { LandingPlan, PlanCandidate, TrainNeed } from '~/utils/mergeTrain'
import type { LandingPlan } from '~/utils/mergeTrain'

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

  /**
   * What landing would do, from the server that would do it.
   *
   * Fetched rather than worked out here on purpose: the merge train draws this
   * order, and a client that re-derived "could this land" would drift from the
   * real rules invisibly — both numbers look plausible, only one is right.
   */
  const plan = useState<LandingPlan | null>('landing-plan', () => null)

  /**
   * A finished landing you have read and put away.
   *
   * The panel showed the newest run whatever its status and nothing ever cleared
   * it, so one landing — successful or not — replaced the "start a session" box
   * on this page permanently. There was no way back: the record is history and
   * deleting it would be wrong, so what was missing was somewhere to say "I have
   * read this". Keyed by id, so the next landing appears regardless.
   */
  const dismissedId = useState<string | null>('landing-dismissed', () => null)

  const showRun = computed(() =>
    run.value && run.value.id !== dismissedId.value ? run.value : null)

  function dismiss() {
    if (run.value) dismissedId.value = run.value.id
  }

  async function refreshPlan() {
    try {
      plan.value = await $fetch<LandingPlan>('/api/landing/plan')
    } catch {
      // A plan that cannot be read is not worth an error on the page; the train
      // simply does not draw until the next attempt succeeds.
      plan.value = null
    }
  }

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
      if (!active.value) {
        stop()
        // The plan is stale the moment a landing ends: bases moved, verdicts
        // expired. Re-read it once here rather than every two seconds.
        await refreshPlan()
      }
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
      dismissedId.value = null
      watch()
      return run.value
    } finally {
      starting.value = false
    }
  }

  onScopeDispose(stop)

  return {
    run, showRun, active, starting, plan,
    start, refresh, refreshPlan, dismiss, watch, stop,
  }
}

/** What each ending is called, and whether it is a good one. */
export const LANDING_OUTCOMES: Record<LandingOutcome, { label: string; good: boolean }> = {
  'merged': { label: 'Merged', good: true },
  // Good, because the work is in. It is only ever surprising, never a problem.
  'already-landed': { label: 'Already in', good: true },
  'checks-failed': { label: 'Checks failed', good: false },
  'conflicts': { label: 'Would conflict', good: false },
  'update-failed': { label: 'Could not update', good: false },
  'no-checks': { label: 'Nothing to verify it', good: false },
  'refused': { label: 'Refused', good: false },
}
