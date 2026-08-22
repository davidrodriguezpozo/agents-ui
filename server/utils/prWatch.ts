import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * What happens to a pull request after it is opened.
 *
 * Opening one was where this used to end. A session did the work, its checks
 * passed in the workspace, a pull request went up — and then the loop broke.
 * CI runs on somebody else's machine against a merge with the base that never
 * happened locally, so it goes red for reasons the workspace could not have
 * known, and the branch sits there until a person notices.
 *
 * That person is the thing this product exists to not require. So a session can
 * keep watching the pull request it opened: read the checks GitHub actually
 * ran, hand a red verdict back to the session that wrote the code, and land it
 * when it comes good.
 *
 * It is the same shape as `sessionRepair` and deliberately so — bounded
 * attempts, acts only on a verdict, cannot silence what it is failing. Three
 * things are different, and all three are because this one is visible to other
 * people:
 *
 *   - **Landing is its own decision.** Watching and fixing pushes to a branch
 *     that is already yours. Merging is the one action here that other people
 *     see, so it is opted into separately and never inherited from "watch this".
 *   - **Silence is not success.** A pull request with no checks reported has not
 *     passed anything. It is never landed on that basis; it says so instead.
 *   - **It reads, then acts.** Every verdict comes from `gh` asking GitHub, not
 *     from what the workspace believed when the branch was pushed.
 *
 * Polled through `gh` on the scheduler's existing event tick, for the reason
 * given in `eventTriggers`: taking webhooks would mean opening a port to the
 * internet, which is a different product with a different threat model.
 */

// --- What GitHub says -------------------------------------------------------

export type PrLifecycle = 'OPEN' | 'MERGED' | 'CLOSED'

export type PrChecksVerdict =
  /** Something is still running. There is no verdict yet. */
  | 'pending'
  /** Everything that reported was happy. */
  | 'passing'
  /** At least one thing that reported was not. */
  | 'failing'
  /** Nothing reported at all — which is not the same as passing. */
  | 'none'

export interface FailingCheck {
  name: string
  url: string
}

export interface PrStatus {
  number: number
  url: string
  state: PrLifecycle
  /** The commit the checks describe. A new push makes a new one. */
  headSha: string
  /**
   * The commit the merge produced on the base branch, once there is one.
   *
   * Not the head commit, and the difference is what makes it worth reading: the
   * head is what CI ran, this is what the base branch now contains. Absent until
   * the pull request is merged, which is most of the time. It is here so a landing
   * can be recorded against a commit — see `SessionLanded.sha` and `revertWatch.ts`.
   */
  mergeSha?: string
  /** GitHub's own word: MERGEABLE, CONFLICTING, or UNKNOWN while it computes. */
  mergeable: string
  checks: PrChecksVerdict
  failing: FailingCheck[]
}

/**
 * One entry of `statusCheckRollup`, which mixes two eras of the same idea.
 *
 * Modern Actions runs arrive as `CheckRun` with a `status` and a `conclusion`;
 * older integrations post a `StatusContext` with a single `state`. Both appear
 * in the same array on the same pull request, so both are read here rather than
 * assuming a repository only has one kind.
 */
export interface RollupRow {
  __typename?: string
  // CheckRun
  name?: string
  status?: string
  conclusion?: string
  detailsUrl?: string
  completedAt?: string
  startedAt?: string
  // StatusContext
  context?: string
  state?: string
  targetUrl?: string
  createdAt?: string
}

/** A conclusion that is a failure rather than a pass or a shrug. */
const BAD_CONCLUSIONS = new Set([
  'FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED', 'STALE',
])

/** A status context in the same condition. */
const BAD_STATES = new Set(['FAILURE', 'ERROR'])

function rowName(row: RollupRow): string {
  return row.name || row.context || 'a check'
}

function rowUrl(row: RollupRow): string {
  return row.detailsUrl || row.targetUrl || ''
}

/**
 * Whether a row has failed, is still going, or is fine.
 *
 * `CANCELLED` is deliberately not a failure. A run cancelled because a newer
 * push superseded it says nothing about the code, and treating it as red would
 * spend a fix attempt on a commit nobody is waiting for. `SKIPPED` and
 * `NEUTRAL` are likewise not failures — a conditional job that decided not to
 * run has not objected to anything.
 */
function rowVerdict(row: RollupRow): 'failing' | 'pending' | 'ok' {
  if (row.__typename === 'StatusContext' || (!row.status && row.state)) {
    const state = (row.state ?? '').toUpperCase()
    if (BAD_STATES.has(state)) return 'failing'
    return state === 'PENDING' ? 'pending' : 'ok'
  }

  const status = (row.status ?? '').toUpperCase()
  if (status !== 'COMPLETED') return 'pending'

  return BAD_CONCLUSIONS.has((row.conclusion ?? '').toUpperCase()) ? 'failing' : 'ok'
}

/** When this row last had something to say, for picking between repeats. */
function rowTime(row: RollupRow): number {
  const stamp = row.completedAt || row.startedAt || row.createdAt
  const parsed = stamp ? Date.parse(stamp) : NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * The latest result for each check, discarding the ones it superseded.
 *
 * The rollup is not one row per check. A real pull request in this repository
 * came back with two `CheckRun` entries both named `build`, from workflow runs
 * four hours apart, against a single head commit — a re-run leaves the earlier
 * attempt in the list.
 *
 * Reading that list flat is the bug this exists to prevent: any failing row
 * makes the pull request failing, so a check that failed and was re-run green
 * would stay red for as long as anyone watched it. The watcher would hand the
 * same already-fixed failure back to the session three times, spend every
 * attempt it had, and give up on a pull request that was passing the whole
 * time.
 *
 * Kept by the newest timestamp, falling back to position — GitHub returns
 * these oldest first, so the later entry is the newer one when the stamps are
 * missing or identical.
 */
function latestPerCheck(rows: RollupRow[]): RollupRow[] {
  const newest = new Map<string, { row: RollupRow; time: number; index: number }>()

  rows.forEach((row, index) => {
    const key = rowName(row)
    const time = rowTime(row)
    const held = newest.get(key)

    if (!held || time > held.time || (time === held.time && index > held.index)) {
      newest.set(key, { row, time, index })
    }
  })

  return [...newest.values()].map(held => held.row)
}

/**
 * One verdict for the whole pull request.
 *
 * Failing beats pending: a suite with one job red and another still going is
 * already known to be red, and waiting for the rest before saying so wastes the
 * time the fix could have been running in. Pending beats passing for the
 * opposite reason — half a green suite is not a green suite, and landing on it
 * would be landing on a partial answer.
 */
export function rollupVerdict(all: RollupRow[]): { verdict: PrChecksVerdict; failing: FailingCheck[] } {
  if (!all.length) return { verdict: 'none', failing: [] }

  const rows = latestPerCheck(all)
  const verdicts = rows.map(rowVerdict)
  const failing = rows
    .filter((_, i) => verdicts[i] === 'failing')
    .map(row => ({ name: rowName(row), url: rowUrl(row) }))

  if (failing.length) return { verdict: 'failing', failing }
  if (verdicts.includes('pending')) return { verdict: 'pending', failing: [] }
  return { verdict: 'passing', failing: [] }
}

/**
 * Ask GitHub where this pull request stands. Read-only.
 *
 * Returns null when the question could not be asked — `gh` missing, not signed
 * in, offline, rate limited. That is not "nothing is wrong", and the caller must
 * not act on it: a watcher that read a failure as "no checks failing" would land
 * a red pull request the first time the network blinked.
 */
export async function readPrStatus(cwd: string, ref: string): Promise<PrStatus | null> {
  try {
    const { stdout } = await exec('gh', [
      'pr', 'view', ref,
      '--json', 'number,url,state,mergeable,headRefOid,mergeCommit,statusCheckRollup',
    ], { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })

    const parsed = JSON.parse(stdout) as {
      number?: number
      url?: string
      state?: string
      mergeable?: string
      headRefOid?: string
      mergeCommit?: { oid?: string } | null
      statusCheckRollup?: RollupRow[] | null
    }

    if (typeof parsed.number !== 'number' || !parsed.url) return null

    const { verdict, failing } = rollupVerdict(parsed.statusCheckRollup ?? [])

    return {
      number: parsed.number,
      url: parsed.url,
      state: (parsed.state ?? 'OPEN').toUpperCase() as PrLifecycle,
      headSha: parsed.headRefOid ?? '',
      mergeSha: parsed.mergeCommit?.oid || undefined,
      mergeable: (parsed.mergeable ?? 'UNKNOWN').toUpperCase(),
      checks: verdict,
      failing,
    }
  } catch {
    return null
  }
}

// --- What the session is doing about it -------------------------------------

export type PrWatchState =
  /** Watching, with nothing to do about it this minute. */
  | 'watching'
  /** A turn is out fixing a red verdict. */
  | 'fixing'
  /** Merged — by this, or by somebody. */
  | 'landed'
  /** Over, and why is in `reason`. */
  | 'stopped'

export interface SessionPrWatch {
  state: PrWatchState
  /** Which pull request, so a session that opened two is unambiguous. */
  number: number
  url: string
  /**
   * Whether to merge it once the checks are green. Separate from watching on
   * purpose: this is the only setting here that other people can see the effect
   * of, and it is never inherited from switching watching on.
   */
  land: boolean
  /** Fix turns spent on this pull request, including one now running. */
  attempts: number
  /** The ceiling this watch began with. */
  max: number
  /**
   * The commit the last fix turn was sent for.
   *
   * CI reports against a commit, and a fix produces a new one. Without this a
   * red verdict for a commit already being worked on would earn a second turn
   * every two minutes until the attempts were gone — three agents fixing the
   * same failure at once, in the same worktree.
   */
  lastHandledSha?: string
  reason?: string
  startedAt: number
  updatedAt: number
  lastPolledAt?: number
}

/**
 * How many red verdicts a pull request gets before this stops.
 *
 * The same number and the same argument as `GIVE_UP_AFTER`: something that
 * cannot fix CI in three goes is not going to fix it in thirty, and the
 * difference is billed. Each attempt here is more expensive than a local repair
 * — it costs a push and a full CI run as well as the turn.
 */
export const MAX_FIX_ATTEMPTS = 3

/**
 * How long an empty rollup is given before it is believed.
 *
 * A pull request opened a moment ago has no checks on it *yet* — Actions has to
 * receive the event and queue the workflow, which takes seconds to a minute.
 * Watching one the instant it is opened is the normal case here, so without
 * this the common path is: open a pull request, press Watch, and be told
 * immediately that the repository has no CI.
 *
 * Five minutes is far longer than queueing takes and far shorter than anyone
 * would wait before wondering. Past it, an empty rollup means what it says.
 */
export const NO_CHECKS_GRACE_MS = 5 * 60_000

export type WatchAction =
  | 'wait'
  | 'fix'
  | 'land'
  /** Nothing left to do and nothing wrong. */
  | 'done'
  /** Nothing left to do and somebody should know. */
  | 'stop'

export interface WatchDecision {
  action: WatchAction
  reason?: string
}

/**
 * What to do about a pull request, given where it stands and what this watch
 * has already tried.
 *
 * Pure, and the whole of the policy. Every branch below is a decision somebody
 * could reasonably want made the other way, which is exactly why it is one
 * function that can be read end to end and tested without a repository.
 */
export function decideWatch(status: PrStatus, watch: SessionPrWatch, now = Date.now()): WatchDecision {
  if (status.state === 'MERGED') {
    return { action: 'done', reason: `#${status.number} has been merged.` }
  }

  if (status.state === 'CLOSED') {
    return { action: 'stop', reason: `#${status.number} was closed without merging.` }
  }

  // Still going. Not news either way, and a verdict is coming.
  if (status.checks === 'pending') return { action: 'wait' }

  if (status.checks === 'failing') {
    // Already sent a turn for this commit. The next verdict worth acting on is
    // the one for whatever that turn pushes.
    if (watch.lastHandledSha && watch.lastHandledSha === status.headSha) {
      return { action: 'wait' }
    }

    if (watch.attempts >= watch.max) {
      return {
        action: 'stop',
        reason: `CI is still failing on #${status.number} after ${watch.max} ${watch.max === 1 ? 'attempt' : 'attempts'}. Over to you.`,
      }
    }

    return { action: 'fix' }
  }

  /**
   * Nothing reported. On a repository with no CI this is the normal state, and
   * it is the one case where doing the obvious thing would be wrong: a pull
   * request that has passed nothing has not passed. Landing here would mean the
   * merge gate this product is built around quietly not applying to the one
   * merge anybody else can see.
   */
  if (status.checks === 'none') {
    // Almost certainly still queueing rather than absent. Ask again shortly.
    if (now - watch.startedAt < NO_CHECKS_GRACE_MS) return { action: 'wait' }

    return watch.land
      ? {
          action: 'stop',
          reason: `#${status.number} has no checks reporting, so there is nothing to land it on. Merge it yourself if that is expected here.`,
        }
      : { action: 'done', reason: `#${status.number} is open, with no checks reporting.` }
  }

  // Green from here down.
  if (!watch.land) {
    return { action: 'done', reason: `#${status.number} is green. Landing is off for this one, so it is yours to merge.` }
  }

  if (status.mergeable === 'CONFLICTING') {
    return {
      action: 'stop',
      reason: `#${status.number} is green but conflicts with its base. That needs a person.`,
    }
  }

  // GitHub computes mergeability asynchronously and says UNKNOWN while it does.
  // Worth one more tick rather than a merge attempt that would be refused.
  if (status.mergeable !== 'MERGEABLE') return { action: 'wait' }

  return { action: 'land' }
}

/**
 * The turn a red pull request earns.
 *
 * It names the checks and hands over the links rather than pasting logs,
 * because the failing log is somebody else's output and this has not seen a
 * real one. The session has `gh` and a shell in the workspace, so the honest
 * move is to say which run failed and let it go and read the thing itself —
 * rather than design a summariser around a payload shape that is a guess.
 *
 * The prohibition matches `repairPrompt` for the same reason it exists there:
 * the shortest path from a red suite to a green one is to stop running it, and
 * on CI that path is a one-line edit to a workflow file.
 */
export function fixPrompt(status: PrStatus, attempt: number, max: number): string {
  const named = status.failing.length
    ? status.failing.map(c => `- ${c.name}${c.url ? ` — ${c.url}` : ''}`).join('\n')
    : '- (GitHub reported a failure without naming the check)'

  const again = attempt > 1
    ? `\nThis is attempt ${attempt} of ${max}. The last one did not fix it, so look again rather than repeating it.\n`
    : ''

  return `CI is failing on the pull request this session opened.

Pull request: ${status.url}
Commit: ${status.headSha || '(unknown)'}

Failing:
${named}
${again}
Find out why it failed and fix it. You have \`gh\` — \`gh run view <id> --log-failed\` and \`gh pr checks ${status.number}\` will get you the actual output, which you should read before changing anything. It failed on GitHub and passed here, so the cause is often something this workspace has and CI does not: an uncommitted file, a dependency that was never added to the lockfile, or a difference against the base branch that only shows up on merge.

Fix the failure, not the check. Do not delete, skip or weaken a test, and do not edit the workflow to stop running it. If the check itself is wrong, say so and explain why instead of editing it away.

Commit what you change. The commit is what gets pushed and what CI runs again — work left uncommitted will not be tested and this will look like it did nothing.

If you cannot fix it, stop and say what is blocking you.`
}

// --- Landing ----------------------------------------------------------------

/**
 * Merge it, the way `gh` would if you typed it.
 *
 * `--merge` rather than squash or rebase: it is the default that matches what
 * the branch looks like locally, and picking a history-rewriting strategy on
 * somebody's behalf, unattended, is not a decision this should be making.
 *
 * **Not `--delete-branch`**, which is the tempting tidy-up and is wrong here.
 * It deletes the local branch as well as the remote one, and this branch is
 * checked out in the session's worktree — git refuses to delete a branch that
 * is, so `gh` exits non-zero *after having merged*. The merge would then be
 * reported as refused while it had in fact landed, which is the worst available
 * outcome. Closing the session already cleans the branch up.
 */
export async function landPullRequest(cwd: string, number: number): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await exec('gh', ['pr', 'merge', String(number), '--merge'], {
      cwd,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return { ok: true }
  } catch (e) {
    const stderr = String((e as { stderr?: string }).stderr ?? '').trim()
    return { ok: false, message: stderr || 'The merge was refused and said nothing about why.' }
  }
}

/**
 * Push what the fix turn committed.
 *
 * Nothing is committed here on the session's behalf. `openPullRequest` makes
 * that opt-in and this keeps the same rule: sweeping up whatever is lying in the
 * worktree and pushing it under an unattended commit message is not a decision
 * to make quietly. The prompt asks for a commit; if there isn't one, that is
 * reported rather than papered over.
 */
export async function pushFix(cwd: string, branch: string): Promise<{ pushed: boolean; message?: string }> {
  try {
    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd, timeout: 30_000 })
    const dirty = stdout.trim()

    /**
     * Whether this branch tracks anything yet.
     *
     * A branch pushed by `openPullRequest` does — it used `push -u`. One whose
     * pull request was opened by hand may not, and `@{upstream}` then fails.
     * Reading that failure as "nothing to commit" would report the turn as
     * having done nothing whenever the branch simply had no upstream set.
     */
    const { stdout: upstream } = await exec(
      'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      { cwd, timeout: 30_000 },
    ).catch(() => ({ stdout: '' }))

    const tracked = Boolean(upstream.trim())

    if (tracked) {
      const { stdout: unpushed } = await exec(
        'git', ['log', '--oneline', '@{upstream}..HEAD'],
        { cwd, timeout: 30_000 },
      )

      if (!unpushed.trim()) {
        return {
          pushed: false,
          message: dirty
            ? 'The turn changed files but committed nothing, so there is nothing to push and CI will not run again.'
            : 'The turn committed nothing, so there is nothing to push.',
        }
      }
    }

    await exec(
      'git',
      tracked ? ['push'] : ['push', '-u', 'origin', branch],
      { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    )
    return { pushed: true }
  } catch (e) {
    const stderr = String((e as { stderr?: string }).stderr ?? '').trim()
    return { pushed: false, message: stderr || 'The push failed and said nothing about why.' }
  }
}
