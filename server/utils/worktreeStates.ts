import { existsSync } from 'node:fs'
import { inFlight, mapLimit } from './pool'
import { worktreeFingerprint } from './checks'
import { currentBranch, diffBase, worktreeStatus, type WorktreeStatus } from './worktrees'

/**
 * The worktree state behind a polled list, without paying for all of it every
 * time the list is polled.
 *
 * Reading one worktree costs four `git` invocations, and a `git` invocation on a
 * repository of any size costs about 35ms whatever else is happening — it is
 * process startup, not contention, so running them all at once does not help.
 * Measured on forty-five sessions across five repositories: 180 spawns and
 * around three seconds however wide the fan-out. Paid every four seconds by a
 * poll, that is a server with nothing left over, and the symptom is not the list
 * at all — it is the session page you opened taking seven seconds to show a
 * conversation it can read in a tenth of one. Eight sessions at once is enough
 * to make it permanent, because each poll starts before the last has answered.
 *
 * So: remember what each worktree last said, and re-read only what could
 * plausibly have moved, a few at a time.
 *
 *   - A session with a turn in flight is re-read almost every poll. Its files
 *     really are changing, and there are only ever a handful of those.
 *   - An idle session's worktree is static — nothing in the app writes to it —
 *     so its answer stands for much longer.
 *   - Whatever is left over is re-read a few per request, oldest first, so a
 *     full sweep happens across several polls rather than in one stall.
 *
 * A session never seen before is always read, because there is nothing to show
 * in its place and a made-up zero would read as "no changes". So the first
 * request after a restart pays in full, and every one after it does not.
 *
 * Anything that needs the truth this instant calls `worktreeStatus` directly,
 * and everything that acts on a session's state — the detail page, the merge and
 * pull request previews, the checks — does exactly that. This is for the list,
 * which is a poll: it was showing you a moment ago either way.
 */

/** A session with a turn in flight. Short, because this one is really moving. */
const LIVE_MS = 2_000

/** Nothing is running in it, so only something outside the app could change it. */
const IDLE_MS = 30_000

/**
 * How many merely-stale worktrees one request will re-read.
 *
 * Bounds what a poll costs no matter how many sessions exist. At the four second
 * poll interval, eight covers forty-five sessions in something under half a
 * minute — well inside the window in which an idle worktree's answer stands.
 */
const REFRESH_BUDGET = 8

export interface WorktreeStateRequest {
  worktreePath: string
  /** What the session branched from — usually a sha. */
  baseRef: string
  baseBranch?: string
  /**
   * The session's own branch, so `diffBase` can tell a real base branch from
   * one that is this branch — a base that moves with HEAD reports every session
   * on it as having done nothing.
   */
  branch?: string
  /**
   * The worktree holds a commit rather than a branch, and was made that way —
   * a review session detached on a pull request's head. Passed through so the
   * base is not "repaired" for a session whose record is correct, and so the
   * extra read below is skipped for the one case that can never drift.
   */
  detached?: boolean
  /**
   * Bumped whenever the session record is written, which every mutation does.
   * A merge, a finished turn or a check therefore invalidates immediately
   * rather than waiting the window out.
   */
  version: string | number
  /** Whether a turn is in flight, which decides how long an answer stands. */
  live: boolean
  /**
   * Also hash the uncommitted diff, to tell whether a recorded check verdict
   * still describes the code. Three more `git` invocations, one of them a full
   * `git diff HEAD`, so it is asked for only where a misleading green is
   * possible — and answered on the same schedule as everything else here,
   * because it goes out of date under exactly the same conditions.
   */
  fingerprint?: boolean
}

export interface WorktreeState {
  status: WorktreeStatus
  /** Null when it was not asked for. */
  fingerprint: string | null
}

interface Cached extends WorktreeState {
  at: number
  version: string
}

const cache = new Map<string, Cached>()

/**
 * Two requests arriving together — a page mounting while a poll is in the air —
 * would otherwise each start their own read of the same cold worktree.
 */
const reading = inFlight<string, WorktreeState>()

function versionOf(request: WorktreeStateRequest): string {
  return `${request.baseRef} ${request.baseBranch ?? ''} ${request.branch ?? ''} ${request.version}`
}

/**
 * What the worktree is actually on, when knowing could change the answer.
 *
 * One more `git` invocation, so it is asked only where it can matter — which is
 * the same rule the fingerprint above follows. Three cases can skip it and
 * together they are most sessions:
 *
 *   - **Detached on purpose.** A review session cannot drift; its record naming
 *     another branch is the design.
 *   - **No branch on record.** Nothing to disagree with.
 *   - **No directory.** `worktreeStatus` is about to report it missing, and a
 *     spawn against a path that is not there buys a failure.
 *
 * `null` means "not asked", which `diffBase` treats as no drift — so a skip here
 * is always the old behaviour rather than a new guess.
 */
async function checkoutOf(request: WorktreeStateRequest): Promise<string | null> {
  if (request.detached) return null
  if (!request.branch) return null
  if (!existsSync(request.worktreePath)) return null

  return currentBranch(request.worktreePath)
}

/**
 * Worktree state for a list of sessions, in the order asked.
 *
 * `now` and `budget` are test seams; real callers pass neither.
 */
export async function worktreeStates(
  requests: readonly WorktreeStateRequest[],
  options: { now?: () => number; budget?: number } = {},
): Promise<WorktreeState[]> {
  const now = options.now ?? Date.now
  const budget = options.budget ?? REFRESH_BUDGET
  const at = now()

  const results = new Array<WorktreeState | undefined>(requests.length)

  /** Nothing to show, so it has to be read whatever the budget says. */
  const cold: number[] = []
  /** Has an answer, but an old one. Read a few of these, oldest first. */
  const stale: number[] = []

  requests.forEach((request, index) => {
    const entry = cache.get(request.worktreePath)

    // A fingerprint wanted and never taken counts as nothing to show, not as a
    // stale answer — otherwise a check verdict could not be judged at all until
    // the sweep came round.
    if (!entry || entry.version !== versionOf(request)
      || (request.fingerprint && entry.fingerprint === null)) {
      cold.push(index)
      return
    }

    results[index] = entry
    if (at - entry.at >= (request.live ? LIVE_MS : IDLE_MS)) stale.push(index)
  })

  // Oldest first, so a sweep works its way round the list rather than favouring
  // whatever happens to come first in it.
  stale.sort((a, b) =>
    cache.get(requests[a]!.worktreePath)!.at - cache.get(requests[b]!.worktreePath)!.at)

  await mapLimit([...cold, ...stale.slice(0, budget)], 8, async (index) => {
    const request = requests[index]!
    const version = versionOf(request)

    const state = await reading(
      `${request.worktreePath} ${version} ${request.fingerprint ? 'fp' : ''}`,
      async () => ({
        // Resolved here rather than by the caller: it costs a `git` invocation
        // per session, and inside the cache it is paid on a miss rather than on
        // every poll of every row.
        status: await worktreeStatus(
          request.worktreePath,
          await diffBase({
            worktreePath: request.worktreePath,
            branch: request.branch ?? '',
            baseBranch: request.baseBranch ?? '',
            baseSha: request.baseRef,
            checkedOut: await checkoutOf(request),
            detached: request.detached,
          }),
          request.baseBranch,
        ),
        fingerprint: request.fingerprint
          ? await worktreeFingerprint(request.worktreePath).catch(() => '')
          : null,
      }),
    )

    cache.set(request.worktreePath, { ...state, at: now(), version })
    results[index] = state
  })

  return results as WorktreeState[]
}

/** Forget what a worktree last said, so the next read is real. For tests. */
export function forgetWorktreeStates(): void {
  cache.clear()
}
