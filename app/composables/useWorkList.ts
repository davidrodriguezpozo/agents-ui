import type { RunQuery } from '~/composables/useRuns'
import type { Session } from '~/composables/useSessions'
import { EMPTY_PULLS, type WallPull, type WallPullsReading } from '~/utils/wall'
import { buildWorkList, railCount, railGroups, tabCounts as countByTab } from '~/utils/workList'

/**
 * Runs a session owns are excluded on the server, not here.
 *
 * On a real machine 49 of the 50 most recent runs were turns of a session that
 * is already its own row, so filtering client-side spent the whole cap on rows
 * that were then discarded — and a ritual run from yesterday was invisible
 * behind fifty turns of one session.
 *
 * Multi-line on purpose. As a one-liner, unimport reads `export const X: T = { a, b }`
 * as a destructuring export and registers `limit` and `hidden` as auto-importable
 * names from this file — so any component that later used a bare `limit` or `hidden`
 * got an import injected for an export that does not exist, and the page 500s with
 * "does not provide an export named 'hidden'".
 */
export const RUNS_QUERY: RunQuery = {
  exclude: ['session'],
  limit: 50,
  hidden: 'exclude',
}

/**
 * The work list, shared by the rail and the page beside it.
 *
 * This used to live in `pages/work.vue`, which was fine while the list and the
 * page were the same thing. They are not any more: the rail shows what is in
 * flight and the page shows what you are doing about it, they are on screen
 * together, and they have to agree — a rail saying a session is blocked next to
 * a page that has not noticed is worse than either on its own.
 *
 * The poll moving in here is the other half of it, and a genuine gain: it is
 * mounted for as long as the rail is, so the status marks keep updating while you
 * are inside a session. Before, opening a session stopped the only poll that
 * watched the others.
 */
export function useWorkList() {
  const { sessions, here, elsewhere, loading, fetchAll } = useSessions()
  const { runs, fetchRuns } = useRuns()
  const { workingDir } = useWorkingDir()

  /**
   * The wall's pull-request reading, held where both surfaces can see it.
   *
   * `useWallPulls` is deliberately not shared state — it is one poll per screen,
   * so that closing the screen closes the poll. That is still the rule; what
   * changed is what counts as a screen. The rail and the pane are one screen
   * now, so the rail runs the single poll and publishes its answer here, and
   * everything else reads it. Two callers of `useWallPulls` on one surface would
   * be two pollers, and — worse — a page whose own reading was permanently
   * empty because the rail's was the one being filled.
   */
  const pulls = useState<WallPullsReading>('work-pulls', () => ({ ...EMPTY_PULLS }))

  /**
   * Which projects the list covers.
   *
   * Kept in shared state rather than in a component, so going into a session and
   * coming back does not quietly narrow the view again — a person who asked to
   * see everything meant it for longer than one navigation.
   */
  const scope = useState<'here' | 'all'>('sessions-scope', () => 'here')

  /**
   * What the poll asks for.
   *
   * Owned here but set by the page, because the page has two views of the runs
   * half — the list, and the rows taken off it — and a poll hard-coded to the
   * first would wipe the second out from under the reader every four seconds.
   */
  const runsQuery = useState<RunQuery>('work-runs-query', () => ({ ...RUNS_QUERY }))

  const poll = useState<ReturnType<typeof setInterval> | null>('work-list-poll', () => null)

  /**
   * Set while a poll is in the air, so the next tick skips rather than stacking.
   *
   * The list costs a few `git` invocations per session, and with enough sessions
   * open it can take longer to build than the gap between polls. Firing anyway
   * meant each tick started before the last had answered, which is self-
   * sustaining: the overlap is what made it slow. A skipped tick costs four
   * seconds of freshness; not skipping cost the whole app.
   */
  const polling = useState<boolean>('work-list-polling', () => false)

  const visibleSessions = computed(() => (scope.value === 'here' ? here.value : sessions.value))

  /** Everything, both tabs, unfiltered — what the counts are read from. */
  const everything = computed(() => buildWorkList({
    sessions: visibleSessions.value,
    runs: runs.value,
  }))

  const tabCounts = computed(() => countByTab(everything.value))

  /** The rail's own view of it: in flight, grouped, empty groups dropped. */
  const groups = computed(() => railGroups(everything.value))
  const inFlightCount = computed(() => railCount(everything.value))

  /**
   * Which pull request each session's work is behind.
   *
   * From the wall's reading rather than a request of its own: it covers every
   * project, is held for a minute on the server, and joins concurrent callers — so
   * a page with forty-five sessions on it costs the same as the Fleet screen
   * already does, and nothing here asks GitHub about a branch one at a time.
   */
  const pullByBranch = computed(() => {
    const map = new Map<string, WallPull>()

    // Both lists, because a session can be behind a pull request you opened *or*
    // one you were asked to look at — a review session is the second kind.
    for (const pull of [...pulls.value.mine, ...pulls.value.reviewing]) {
      if (pull.headBranch) map.set(`${pull.repoDir}\u0000${pull.headBranch}`, pull)
    }

    return map
  })

  /**
   * The pull request for one session.
   *
   * Keyed on the repository as well as the branch: five projects on one machine
   * routinely share branch names — `main`, and every `fix/typo` anybody has ever
   * pushed — and a card showing another repository's pull request would be a
   * worse lie than showing none.
   *
   * A drifted session is looked up by the branch it is *really* on, since that is
   * where its commits are and therefore which pull request they belong to.
   */
  function pullFor(session: Session): WallPull | null {
    const branch = session.driftedTo || session.branch
    return pullByBranch.value.get(`${session.repoDir}\u0000${branch}`) ?? null
  }

  /** A session nobody has answered is the reason to look at another project. */
  function needsYou(list: Session[]) {
    return list.filter(
      s => s.activity === 'awaiting-permission'
        || (s.activity === 'idle' && s.check?.status === 'failing'),
    ).length
  }

  const elsewhereNeedsYou = computed(() => needsYou(elsewhere.value))

  async function refresh() {
    await Promise.all([fetchAll(), fetchRuns(runsQuery.value)])
  }

  /**
   * Only poll while something could change on its own — but that now includes a
   * ritual firing, which no session on this page would report.
   */
  function watchContinuously(everyMs = 4000) {
    if (poll.value) return

    poll.value = setInterval(async () => {
      if (polling.value) return
      const live = sessions.value.some(s => s.activity === 'working')
        || runs.value.some(r => r.status === 'running' || r.status === 'queued')
      if (!live) return

      polling.value = true
      try {
        await refresh()
      } finally {
        polling.value = false
      }
    }, everyMs)
  }

  function stopWatching() {
    if (!poll.value) return
    clearInterval(poll.value)
    poll.value = null
  }

  // With no project selected there is no "here" to narrow to, and the toggle
  // would be a control with one working position.
  watchEffect(() => { if (!workingDir.value) scope.value = 'all' })

  return {
    pulls,
    sessions,
    here,
    elsewhere,
    elsewhereNeedsYou,
    runs,
    loading,
    scope,
    runsQuery,
    visibleSessions,
    everything,
    tabCounts,
    groups,
    inFlightCount,
    pullFor,
    refresh,
    watchContinuously,
    stopWatching,
  }
}
