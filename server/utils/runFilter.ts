/**
 * Narrowing the run log.
 *
 * Activity is append-only and never prunes, so after a few weeks of rituals it
 * is hundreds of entries long and "scroll until you recognise it" stops
 * working. These are the three questions people actually arrive with: what
 * started it, how it ended, and what it was about.
 *
 * Deliberately structural rather than typed against `Run`: the store imports
 * this, and this importing the store back would be a cycle.
 */

export type RunSource = 'ritual' | 'session' | 'agent' | 'command'
export type RunOutcomeFilter = 'running' | 'completed' | 'failed' | 'cancelled' | 'attention'

export interface FilterableRun {
  title: string
  input?: string
  invocation?: string
  agentSlug?: string
  output?: string
  status: string
  kind: string
  scheduleId?: string
  sessionId?: string
  needsAttention?: boolean
  deniedTools?: string[]
  refusedHosts?: string[]
  hiddenAt?: number
}

export interface RunFilter {
  q?: string
  outcome?: RunOutcomeFilter
  source?: RunSource
  /**
   * Sources to leave out, applied before the limit.
   *
   * Work lists a session as one row however many turns it took, so it discards
   * runs a session owns — and on a real machine 49 of the 50 most recent runs
   * were exactly those. Filtering them out here rather than in the page is the
   * difference between the cap being spent on rows that appear and a ritual run
   * from yesterday being invisible behind fifty turns of one session.
   */
  exclude?: RunSource[]
  /**
   * What to do about rows the reader has taken off the Work list.
   *
   * Undefined means show everything, and that default is deliberate rather than
   * lazy. `listRuns` is also what `failingStreak`, the spend total and the
   * night-shift figures are read through, and if hiding a row quietly removed it
   * from those too then tidying a list would be a way to make a broken ritual
   * look healthy. So only the caller that renders the Work list asks to exclude,
   * and every other reading of history is untouched by what has been tidied.
   */
  hidden?: 'exclude' | 'only'
}

/** What set this run going, which is the thing people remember about it. */
export function sourceOf(run: FilterableRun): RunSource {
  if (run.scheduleId) return 'ritual'
  if (run.sessionId) return 'session'
  if (run.kind === 'agent') return 'agent'
  return 'command'
}

function matchesOutcome(run: FilterableRun, outcome: RunOutcomeFilter): boolean {
  switch (outcome) {
    case 'running':
      return run.status === 'running' || run.status === 'queued'
    // Its own filter rather than a kind of failure: these runs report success
    // while having skipped the part that needed a permission.
    case 'attention':
      return Boolean(run.needsAttention || run.deniedTools?.length || run.refusedHosts?.length)
    case 'completed':
      return run.status === 'completed' && !run.needsAttention && !run.deniedTools?.length
        && !run.refusedHosts?.length
    default:
      return run.status === outcome
  }
}

/**
 * Searches what the run *said* as well as what it was called — the memorable
 * part of a run is usually a phrase from its answer, not its title.
 */
function matchesQuery(run: FilterableRun, query: string): boolean {
  return [run.title, run.input, run.invocation, run.agentSlug, run.output]
    .some(field => field?.toLowerCase().includes(query))
}

export function matchesFilter(run: FilterableRun, filter: RunFilter): boolean {
  if (filter.hidden === 'exclude' && run.hiddenAt) return false
  if (filter.hidden === 'only' && !run.hiddenAt) return false

  const source = sourceOf(run)
  if (filter.source && source !== filter.source) return false
  if (filter.exclude?.includes(source)) return false
  if (filter.outcome && !matchesOutcome(run, filter.outcome)) return false

  const query = filter.q?.trim().toLowerCase()
  if (query && !matchesQuery(run, query)) return false

  return true
}
