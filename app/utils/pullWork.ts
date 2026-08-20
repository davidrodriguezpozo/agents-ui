import type { Session } from '~/composables/useSessions'

/**
 * Whether you have already started on a pull request.
 *
 * Land is a list of decisions, and every row offers the same one: start a
 * session on this. What the row never said is that you already did — an hour
 * ago, in a session that is still open two screens away, possibly mid-turn. So
 * the page invited you to start work that exists, and the only way to find out
 * was to press the button and read the toast afterwards. The information was
 * already on the machine; nothing joined it up.
 *
 * The join has to happen here rather than by asking the server, because both
 * halves are already loaded: `/api/github/pulls` for the rows and the sessions
 * store for the work. A third endpoint to tell you what two lists in memory
 * agree on would be a request that can be stale against the page that made it.
 *
 * Two things identify a session's pull request, and both are needed:
 *
 *   - **`prUrl`** — set when this app opened the pull request, or when it
 *     started a session *from* one. Exact, and survives the branch being
 *     renamed or the checkout wandering off.
 *   - **The branch** — for everything else: a session started from a branch that
 *     somebody else later opened a pull request on, or one whose agent ran
 *     `gh pr checkout` and drifted. Read from `driftedTo` first for the reason
 *     `~/utils/checkout` gives: that is where the commits actually are.
 *
 * A detached review session matches on the branch too. Its worktree holds a
 * commit on purpose and `driftedTo` is null, but the record names the head
 * branch — which is precisely what identifies the work.
 */

/** What this needs of a pull request, so a test can hand it three fields. */
export interface PullRef {
  number: number
  url: string
  headBranch: string
}

/** What this needs of a session. */
export type WorkSession = Pick<
  Session,
  'id' | 'title' | 'branch' | 'status' | 'activity' | 'updatedAt'
> & Partial<Pick<Session, 'driftedTo' | 'prUrl' | 'detached' | 'filedAt' | 'turnCount'>>

/** One session, and why it counts as work on this pull request. */
export interface PullWorker {
  id: string
  title: string
  /** How it was matched, which is worth saying: a review is not a change. */
  how: 'pr-url' | 'branch'
  /** It only reads the pull request — a review checkout. */
  reviewing: boolean
  /** You said you were done with it. Still open, still holds the branch. */
  setAside: boolean
  activity: Session['activity']
  updatedAt: number
}

export type PullWorkTone = 'attention' | 'problem' | 'live' | 'ready' | 'quiet'

/** The row's answer to "have I started this?", already decided. */
export interface PullWork {
  /** Strongest first — see `RANK`. Never empty; no work means no `PullWork`. */
  workers: PullWorker[]
  /** Where pressing it goes. The one you would want to see first. */
  primary: PullWorker
  label: string
  detail: string
  icon: string
  tone: PullWorkTone
  spin: boolean
}

/** `owner/repo` and the number, from either kind of URL GitHub hands out. */
function parsePullUrl(url: string): { slug: string; number: number } | null {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/i.exec(url)
  if (!match) return null
  return { slug: match[1]!.toLowerCase(), number: Number(match[2]) }
}

/**
 * Whether a session's recorded pull request is this one.
 *
 * The slug is compared as well as the number, because #482 exists in every
 * repository anybody has ever worked in and the sessions store holds every
 * project on the machine. Comparing numbers alone would put another
 * repository's session on this row, which is worse than showing nothing.
 */
function samePull(prUrl: string | undefined, pull: PullRef): boolean {
  if (!prUrl) return false
  const mine = parsePullUrl(prUrl)
  const theirs = parsePullUrl(pull.url)
  if (!mine) return false
  if (!theirs) return mine.number === pull.number
  return mine.slug === theirs.slug && mine.number === theirs.number
}

/**
 * Which end of the row a session belongs at.
 *
 * Ordered by what you would want to be told first about work you forgot you
 * started: something is stuck waiting for you, something is running, something
 * is sitting there finished, something you have already filed.
 */
const RANK: Record<string, number> = {
  'awaiting-permission': 0,
  failed: 1,
  working: 2,
  idle: 3,
  missing: 4,
}

function rankOf(worker: PullWorker): number {
  // Filed outranks nothing. It is open work by the letter of it — the workspace
  // is there and the branch is held — but you have said it is settled, so it
  // must never be the thing the row shouts about while a live session exists.
  return (worker.setAside ? 10 : 0) + (RANK[worker.activity] ?? 5)
}

/**
 * The sessions working on one pull request, strongest first.
 *
 * Archived sessions are left out: their worktree is gone, so they are history
 * rather than work in progress, and a row claiming three open sessions on a
 * pull request finished last week is the kind of confident wrong number that
 * costs a page its credibility.
 *
 * Callers must pass sessions from the same repository as the pull request —
 * `inCurrentProject` on the Land page. Nothing here can check it: a session
 * knows its `repoDir` and a pull request, at this point, does not.
 */
export function workersOnPull(pull: PullRef, sessions: WorkSession[]): PullWorker[] {
  const workers: PullWorker[] = []

  for (const session of sessions) {
    if (session.status === 'archived') continue

    const byUrl = samePull(session.prUrl, pull)
    const branch = session.driftedTo || session.branch
    const byBranch = Boolean(pull.headBranch) && branch === pull.headBranch

    if (!byUrl && !byBranch) continue

    workers.push({
      id: session.id,
      title: session.title,
      how: byUrl ? 'pr-url' : 'branch',
      reviewing: Boolean(session.detached),
      setAside: Boolean(session.filedAt),
      activity: session.activity,
      updatedAt: session.updatedAt,
    })
  }

  // Most recently touched breaks a tie, so two idle sessions on one branch put
  // the one you were last in first.
  return workers.sort((a, b) => rankOf(a) - rankOf(b) || b.updatedAt - a.updatedAt)
}

/** What one worker is called, when it is the only one. */
function labelFor(worker: PullWorker): { label: string; icon: string; tone: PullWorkTone; spin: boolean } {
  if (worker.activity === 'awaiting-permission') {
    return { label: 'Session needs you', icon: 'i-lucide-hand', tone: 'attention', spin: false }
  }
  if (worker.activity === 'failed') {
    return { label: 'Session failed', icon: 'i-lucide-circle-alert', tone: 'problem', spin: false }
  }
  if (worker.activity === 'working') {
    return {
      label: worker.reviewing ? 'Reviewing now' : 'Working on it',
      icon: 'i-lucide-loader-2',
      tone: 'live',
      spin: true,
    }
  }
  if (worker.activity === 'missing') {
    return { label: 'Workspace gone', icon: 'i-lucide-unlink', tone: 'quiet', spin: false }
  }
  if (worker.setAside) {
    return { label: 'Set aside', icon: 'i-lucide-archive', tone: 'quiet', spin: false }
  }

  // Idle, and yours. Which of the two it is matters more than the word "idle":
  // a review you left half-read and a branch you have been editing want
  // different things from you.
  return {
    label: worker.reviewing ? 'Review open' : 'Session open',
    icon: worker.reviewing ? 'i-lucide-scan-eye' : 'i-lucide-git-branch',
    tone: 'ready',
    spin: false,
  }
}

/**
 * What the row says, given everything that matched.
 *
 * One session is named by what it is doing. Several are counted, and take the
 * state of the strongest — a pull request with a session mid-turn and two idle
 * ones beside it is, for the purpose of a glance down the page, being worked on.
 */
export function pullWork(pull: PullRef, sessions: WorkSession[]): PullWork | null {
  const workers = workersOnPull(pull, sessions)
  const primary = workers[0]
  if (!primary) return null

  const first = labelFor(primary)
  const others = workers.length - 1

  return {
    workers,
    primary,
    label: others ? `${workers.length} sessions` : first.label,
    // The tooltip, and the one place the session's own name appears — the chip
    // has room for a state or a title and the state is the part you cannot
    // guess.
    detail: others
      ? `${first.label} · ${primary.title} · and ${others} more`
      : `${first.label} · ${primary.title}`,
    icon: first.icon,
    tone: first.tone,
    spin: first.spin,
  }
}

/**
 * Every pull request on the page, joined to the work in one pass.
 *
 * A map rather than a call per row, because a template that calls a matcher in
 * a `v-for` re-runs it for every row on every unrelated reactive change, and
 * this side of the join is forty-five sessions.
 */
export function workByPull(pulls: PullRef[], sessions: WorkSession[]): Map<number, PullWork> {
  const map = new Map<number, PullWork>()

  for (const pull of pulls) {
    const work = pullWork(pull, sessions)
    if (work) map.set(pull.number, work)
  }

  return map
}
