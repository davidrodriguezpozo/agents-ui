import type { RunSummary } from '~/composables/useRuns'
import type { Session } from '~/composables/useSessions'
import { isSettled, outcomeOf } from '~/utils/sessionOutcome'

/**
 * Sessions and runs as one list of work.
 *
 * The reason this is harder than it looks, written down because it is the whole
 * design: a session's states are about *what you do with the changes* — it needs
 * you, it is ready to land, nothing came of it — and a run's are about *whether
 * it happened*. Forced into one enum, half the values are meaningless on half
 * the rows, and the loser is the sessions list.
 *
 * So there are two layers instead of one. `status` is the coarse question that
 * is genuinely true of both and is what the filters offer. `outcome` is a
 * sentence in the row's own vocabulary, and nothing filters on it — "Ready to
 * land" and "Nothing came of it" are both *done*, and only a session can be
 * either.
 *
 * The other half of the job is what a row *is*. Activity listed one row per run,
 * so a four-turn session appeared four times, competing with itself. A row here
 * is one piece of work you would act on: a session however many turns it took,
 * or a run that no session owns.
 */

export type WorkOrigin = 'session' | 'ritual' | 'agent' | 'command'

/**
 * The coarse question, and the only thing worth filtering on.
 *
 * `yours` is the one that is not about the machine. Every other value here
 * describes what a process did; that one describes whose turn it is — a session
 * that has stopped, produced no reason to be worried about, and is waiting for
 * you to say the next thing. It used to come out as `done`, which is how a
 * conversation you were halfway through ended up filed under History.
 */
export type WorkStatus = 'running' | 'needs-you' | 'yours' | 'done' | 'failed'

export interface WorkItem {
  key: string
  origin: WorkOrigin
  status: WorkStatus
  title: string
  /** Where it got to, in the words its own kind uses. Never filtered on. */
  outcome: string
  /** The quiet line: a branch, an invocation, what it did. */
  detail?: string
  to: string
  at: number
  costUsd?: number
  durationMs?: number
  /** Sessions only: work sitting in a workspace, waiting on a decision. */
  changedFiles?: number
  turnCount?: number
  /**
   * Runs only: the id to address it by, so removing a row does not mean taking
   * `key` apart to find the thing it refers to.
   */
  runId?: string
  /** Set when this row has been taken off the list, so it can be put back. */
  hiddenAt?: number
}

export const WORK_STATUS: { value: WorkStatus; label: string }[] = [
  { value: 'running', label: 'running' },
  { value: 'needs-you', label: 'needs you' },
  { value: 'yours', label: 'your turn' },
  { value: 'done', label: 'done' },
  { value: 'failed', label: 'failed' },
]

/**
 * The two halves of the list, and the only reason /work has tabs.
 *
 * A session that is running and a ritual that failed on Tuesday are both "work",
 * but nobody is ever looking for both at once: one is a thing you might
 * interrupt, the other is a thing you are reading about. Held in one list they
 * fight — the finished rows are the overwhelming majority, so the two you could
 * act on sit at the bottom of forty you cannot.
 *
 * The tab is the coarse cut and the chips are the fine one *within* it, which is
 * why this lives beside `WORK_STATUS` rather than being a fifth chip: a chip you
 * have to press to stop seeing last week is a default that is wrong.
 */
export type WorkTab = 'flight' | 'history'

/**
 * Which tab owns which status.
 *
 * The cut is *open versus settled*, not *stopped versus running*, and that
 * distinction is the whole reason this list needed a fifth status. Whether a
 * turn is currently executing is a fact about the last few seconds; whether the
 * work is finished with is a fact about the work. Reading the tab off the first
 * one put a session with twelve uncommitted files, and every session waiting on
 * a reply from you, under History — where you go to read about things, not to do
 * them.
 */
export const TAB_STATUSES: Record<WorkTab, WorkStatus[]> = {
  flight: ['running', 'needs-you', 'yours'],
  history: ['done', 'failed'],
}

export function tabOf(status: WorkStatus): WorkTab {
  return TAB_STATUSES.flight.includes(status) ? 'flight' : 'history'
}

/** How many rows each tab holds, read off `TAB_STATUSES` so it cannot drift. */
export function tabCounts(items: WorkItem[]): Record<WorkTab, number> {
  const counts: Record<WorkTab, number> = { flight: 0, history: 0 }
  for (const item of items) counts[tabOf(item.status)]++
  return counts
}

/** The rows one tab is responsible for. Origin and search still apply on top. */
export function onTab(items: WorkItem[], tab: WorkTab): WorkItem[] {
  return items.filter(item => tabOf(item.status) === tab)
}

export const WORK_ORIGIN: { value: WorkOrigin; label: string; icon: string }[] = [
  { value: 'session', label: 'yours', icon: 'i-lucide-git-branch' },
  { value: 'ritual', label: 'rituals', icon: 'i-lucide-alarm-clock' },
  { value: 'agent', label: 'agents', icon: 'i-lucide-bot' },
  { value: 'command', label: 'commands', icon: 'i-lucide-terminal' },
]

export const STATUS_LOOK: Record<WorkStatus, { icon: string; colour: string }> = {
  running: { icon: 'i-lucide-loader-2', colour: 'var(--accent)' },
  'needs-you': { icon: 'i-lucide-hand', colour: 'var(--warning)' },
  // Not amber. A session waiting on your reply is not a problem, and dressing
  // it as one is how "needs you" stops meaning anything.
  yours: { icon: 'i-lucide-corner-down-left', colour: 'var(--info)' },
  done: { icon: 'i-lucide-check', colour: 'var(--success)' },
  failed: { icon: 'i-lucide-x', colour: 'var(--error)' },
}

/** A session, in its own words. `outcomeOf` already decides the hard part. */
export function fromSession(session: Session): WorkItem {
  const outcome = outcomeOf(session)

  const [status, label]: [WorkStatus, string] = (() => {
    switch (outcome) {
      case 'working':
        return ['running', 'Working']
      case 'needs-you':
        if (session.activity === 'awaiting-permission') return ['needs-you', 'Waiting for permission']
        if (session.activity === 'failed') return ['failed', 'Its last turn failed']
        // Finished, and does not work — which is not the same as failing to run.
        return ['needs-you', 'Checks fail']
      case 'ready':
        if (session.landed) return ['done', 'Merged']
        // Work sitting in a workspace nobody has merged is the definition of
        // unfinished, whatever the process table says. It leaves this tab when
        // it lands or when you set it aside, and not before.
        return isSettled(session) ? ['done', 'Set aside'] : ['yours', 'Ready to land']
      case 'gone':
        return ['done', 'Workspace gone']
      default:
        // Nothing produced — which is what a session that answered a question
        // looks like, and also what one you abandoned looks like. The two are
        // told apart by whether you have come back to it: see `isSettled`.
        if (!isSettled(session)) return ['yours', 'Your turn']
        return ['done', session.filedAt ? 'Set aside' : 'Nothing came of it']
    }
  })()

  return {
    key: `session:${session.id}`,
    origin: 'session',
    status,
    title: session.title,
    outcome: label,
    detail: session.summary?.text ?? session.branch,
    to: `/sessions/${session.id}`,
    at: session.updatedAt,
    changedFiles: session.worktree?.changedFiles,
    turnCount: session.turnCount,
  }
}

/** A run, in its own. */
export function fromRun(run: RunSummary): WorkItem {
  const [status, label]: [WorkStatus, string] = (() => {
    if (run.status === 'queued') return ['running', 'Waiting its turn']
    if (run.status === 'running') return ['running', 'Running']

    // A run that used up its turns or its budget did not need anything from
    // you — it needed more room. Saying "needed you" of it is the badge lying,
    // and it is not a failure either.
    if (run.stoppedBy === 'turns') return ['needs-you', 'Ran out of turns']
    if (run.stoppedBy === 'budget') return ['needs-you', 'Reached the spending limit']

    if (run.needsAttention || run.deniedTools?.length) return ['needs-you', 'Needed you']
    if (run.status === 'failed') return ['failed', 'Failed']
    if (run.status === 'cancelled') return ['done', 'Stopped by you']
    return ['done', 'Completed']
  })()

  return {
    key: `run:${run.id}`,
    runId: run.id,
    hiddenAt: run.hiddenAt,
    // 'session' is filtered out before this is ever called, so the fallback is
    // only here to keep the type honest.
    origin: (run.source === 'session' ? 'agent' : run.source) as WorkOrigin,
    status,
    title: run.title,
    outcome: label,
    detail: run.invocation ?? run.error ?? run.preview,
    to: `/runs/${run.id}`,
    at: run.completedAt ?? run.startedAt ?? run.createdAt,
    costUsd: run.costUsd,
    durationMs: run.durationMs,
  }
}

export interface WorkInput {
  sessions: Session[]
  /**
   * Runs as the server returned them, already filtered and capped there.
   *
   * Runs whose source is a session are dropped: that session is its own row, and
   * listing its turns beside it is how a four-turn session came to appear four
   * times in Activity, competing with itself for your attention.
   */
  runs: RunSummary[]
}

export interface WorkFilters {
  status?: WorkStatus | null
  origin?: WorkOrigin | null
  /** Matched against sessions here; the server has already matched the runs. */
  query?: string
}

export function buildWorkList({ sessions, runs }: WorkInput, filters: WorkFilters = {}): WorkItem[] {
  const q = (filters.query ?? '').trim().toLowerCase()

  const items: WorkItem[] = []

  for (const session of sessions) {
    if (session.status === 'archived') continue
    const item = fromSession(session)
    // Sessions are all here, so they are searched here. Runs arrive already
    // narrowed by the server, because that list is capped and searching one
    // page of it would only search that page.
    if (q && !`${item.title} ${item.detail ?? ''}`.toLowerCase().includes(q)) continue
    items.push(item)
  }

  for (const run of runs) {
    if (run.source === 'session') continue
    items.push(fromRun(run))
  }

  return items
    .filter(item => !filters.status || item.status === filters.status)
    .filter(item => !filters.origin || item.origin === filters.origin)
    .sort(byUrgencyThenRecency)
}

/**
 * What is stuck, then what is happening, then everything else newest first.
 *
 * Recency alone buries a session that has been blocked since 02:00 under
 * whatever ran most recently, which is how the old list managed to hide the one
 * row that wanted something.
 */
const STATUS_RANK: Record<WorkStatus, number> = {
  'needs-you': 0,
  failed: 1,
  running: 2,
  yours: 3,
  done: 4,
}

export function byUrgencyThenRecency(a: WorkItem, b: WorkItem): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.at - a.at
}

/** How many of each status the unfiltered list holds, for the filter chips. */
export function statusCounts(items: WorkItem[]): Record<WorkStatus, number> {
  const counts: Record<WorkStatus, number> = {
    running: 0, 'needs-you': 0, yours: 0, done: 0, failed: 0,
  }
  for (const item of items) counts[item.status]++
  return counts
}

/**
 * The rows a "clear" would take.
 *
 * Only runs, and only finished ones. A session is not a run and removing one
 * would have to mean deleting a worktree, which is a different act with its own
 * confirmation. A row still running is left alone because removing it reads as
 * cancelling it, and it is not: the run would carry on invisibly and land where
 * nobody is looking.
 *
 * Given the already-filtered list, so the button can only ever take what is on
 * screen — a clear whose scope you cannot predict is one nobody presses twice.
 */
export function removableRuns(items: WorkItem[]): WorkItem[] {
  return items.filter(item => item.runId && item.status !== 'running')
}

/**
 * The rail's groups, in the order they are worth reading.
 *
 * Not `WORK_STATUS` and not `STATUS_RANK`, though it agrees with both. Those are
 * a row of filter chips and a sort comparator; this is a set of headings, and a
 * heading is written differently from a chip — "Needs you" above four rows, not
 * "needs you" on a button you press.
 *
 * The order is urgency, which is deliberately *not* the order the statuses are
 * declared in: something asking for a decision comes before something that is
 * merely still going, because scrolling past the first one is a mistake and
 * scrolling past the second one is not.
 *
 * Every status the in-flight tab owns has to appear here exactly once — see the
 * guard in `test/workRail.test.ts`. A status missing from this table would be a
 * session the rail silently never shows, which is the worst failure available to
 * a list whose whole job is that nothing gets lost.
 */
export const RAIL_GROUPS: { status: WorkStatus; title: string }[] = [
  { status: 'needs-you', title: 'Needs you' },
  { status: 'running', title: 'Working' },
  { status: 'yours', title: 'Your turn' },
]

export interface RailGroup {
  status: WorkStatus
  title: string
  items: WorkItem[]
}

/**
 * The in-flight work, grouped for the rail.
 *
 * Takes the whole list rather than a pre-filtered one and does the in-flight cut
 * itself, so the rail cannot end up disagreeing with the tab about what "in
 * flight" means. Empty groups are dropped: a heading with nothing under it is a
 * claim that there is something there.
 *
 * Order within a group is left as given — `buildWorkList` has already sorted by
 * urgency and then recency, and re-sorting here would quietly overrule it.
 */
export function railGroups(items: WorkItem[]): RailGroup[] {
  const inFlight = onTab(items, 'flight')

  return RAIL_GROUPS
    .map(group => ({ ...group, items: inFlight.filter(item => item.status === group.status) }))
    .filter(group => group.items.length > 0)
}

/** How many rows the rail is showing, for the count beside its heading. */
export function railCount(items: WorkItem[]): number {
  return onTab(items, 'flight').length
}
