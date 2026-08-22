/**
 * Bringing a moved base into the sessions left behind.
 *
 * The offer, and the press. Deliberately not wired to anything that happens on
 * its own: merging is a thing somebody did, and rewriting five other workspaces
 * is not implied by it. So this loads a count when there is a reason to show one
 * — after a landing — and does nothing at all until pressed.
 *
 * Mirrors `GET`/`POST /api/landing/sweep`, and only as far as the page reads it.
 * The server is the authority on who can be brought forward; a page that decided
 * that for itself would disagree with the pass the first time either side
 * changed, and both numbers would look plausible.
 */

export type SweepDisposition = 'update' | 'current' | 'skip'

export interface SweepCandidate {
  id: string
  title: string
  disposition: SweepDisposition
  reason?: string
  behind?: number
}

export interface SweepPlan {
  repoDir: string | null
  baseBranch: string | null
  candidates: SweepCandidate[]
  /** How many would actually be touched. What the offer counts. */
  updating: number
}

export type SweepOutcome = 'updated' | 'updated-unverified' | 'conflicted' | 'skipped' | 'failed'

export interface SweepResult {
  id: string
  title: string
  outcome: SweepOutcome
  message: string
  runId?: string
  check?: 'passing' | 'failing' | 'errored'
  conflicts?: string[]
}

export function useBaseSweep() {
  const plan = useState<SweepPlan | null>('base-sweep-plan', () => null)
  const results = useState<SweepResult[] | null>('base-sweep-results', () => null)
  const summary = useState<string | null>('base-sweep-summary', () => null)
  const loading = useState('base-sweep-loading', () => false)
  const running = useState('base-sweep-running', () => false)
  const error = useState<string | null>('base-sweep-error', () => null)

  /** Ask who is behind. A `git` call per session, so never on a poll. */
  async function load() {
    loading.value = true
    try {
      plan.value = await $fetch<SweepPlan>('/api/landing/sweep')
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      loading.value = false
    }
  }

  async function run() {
    running.value = true
    error.value = null
    try {
      const answer = await $fetch<{ plan: SweepPlan; results: SweepResult[]; summary: string }>(
        '/api/landing/sweep',
        { method: 'POST' },
      )
      results.value = answer.results
      summary.value = answer.summary
      // Re-read rather than assume: a session that conflicted is still behind,
      // and the offer must not keep counting the ones it already brought forward.
      await load()
      return answer
    } catch (e) {
      error.value = errorMessage(e)
      return null
    } finally {
      running.value = false
    }
  }

  /** Put the report away. The offer comes back if anybody is still behind. */
  function dismiss() {
    results.value = null
    summary.value = null
  }

  return { plan, results, summary, loading, running, error, load, run, dismiss }
}
