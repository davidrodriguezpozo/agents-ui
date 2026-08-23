import { getProjectDir } from '../../utils/scope'
import { readSessions } from '../../utils/sessions'
import { mapLimit } from '../../utils/pool'
import { worktreeStates } from '../../utils/worktreeStates'
import { mergedBranches } from '../../utils/merge'
import { landedInBase } from '../../utils/lander'
import { isStale } from '../../utils/checks'
import { getActive, readRun } from '../../utils/runStore'
import { listPending } from '../../utils/permissionBroker'
import { checkoutDrifted } from '~/utils/checkout'
import { findOverlaps } from '~/utils/overlap'

/**
 * Sessions with the live state of their worktree and their current run.
 *
 * "Running" is not enough to act on: a session waiting for a permission answer
 * looks identical to one that is working, and only one of them needs you. The
 * activity field distinguishes them so the list can say which is which.
 *
 * This is polled, and what it costs is per session rather than fixed — so with
 * enough sessions open it stopped being a list and became a load problem, which
 * everything else on the server then queued behind. The run state below is cheap
 * and always current; `worktreeStates` decides what git is asked on any given
 * poll and what stands from the last one.
 */
export type SessionActivity = 'idle' | 'working' | 'awaiting-permission' | 'failed' | 'missing'

/** Enough to keep the disk busy, few enough to leave the server responsive. */
const AT_ONCE = 8

export default defineEventHandler(async (event) => {
  const projectDir = getProjectDir(event)
  const sessions = await readSessions()

  /**
   * Which branches the base already contains, one question per repository.
   *
   * Needed because "behind" is not the whole story: a session whose work has
   * landed is still behind the merge commit that landed it, and reporting only
   * that told four finished sessions they had a base that had moved on — work to
   * do, when there was none. Asked per repo rather than per session because this
   * endpoint is polled and somebody can easily have twenty-one of them.
   */
  const repos = new Map<string, string>()
  for (const session of sessions) repos.set(session.repoDir, session.baseBranch)

  const mergedByRepo = new Map<string, Set<string>>(
    await Promise.all([...repos].map(async ([dir, base]) =>
      [dir, await mergedBranches(dir, base)] as const)),
  )

  /**
   * The run each session is on, before anything touches git.
   *
   * Read first because it decides how hard the worktree needs looking at: a
   * session with a turn in flight is genuinely changing, while one that has been
   * idle for an hour cannot have moved on its own.
   */
  const runs = await mapLimit(sessions, AT_ONCE, async (session) => {
    const lastRunId = session.runIds.at(-1)
    const lastRun = lastRunId ? getActive(lastRunId)?.run ?? await readRun(lastRunId) : null
    const pending = lastRunId ? listPending(lastRunId).length : 0

    return {
      lastRunId: lastRunId ?? null,
      status: lastRun?.status ?? null,
      pending,
      live: pending > 0 || lastRun?.status === 'running' || lastRun?.status === 'queued',
    }
  })

  const states = await worktreeStates(sessions.map((session, index) => ({
    worktreePath: session.worktreePath,
    baseRef: session.baseSha || session.baseBranch,
    baseBranch: session.baseBranch,
    branch: session.branch,
    detached: session.detached,
    version: session.updatedAt,
    live: runs[index]!.live,
    // Everything `activity === 'idle'` needs except whether the worktree is
    // still there — and a fingerprint of one that is gone comes back empty,
    // which is never stale. So this is the same condition, asked early enough to
    // be answered in the same pass rather than in a second round of spawns.
    fingerprint: Boolean(
      session.check
      && session.check.status !== 'running'
      && !runs[index]!.live
      && runs[index]!.status !== 'failed',
    ),
  })))

  const rows = sessions.map((session, index) => {
    const { status: worktree, fingerprint } = states[index]!
    const { lastRunId, status, pending } = runs[index]!

    let activity: SessionActivity = 'idle'
    if (!worktree.exists) activity = 'missing'
    else if (pending) activity = 'awaiting-permission'
    else if (status === 'running' || status === 'queued') activity = 'working'
    else if (status === 'failed') activity = 'failed'

    // Only for a session with a settled verdict to be stale, and never mid-turn.
    const settled = session.check && session.check.status !== 'running' && activity === 'idle'

    /**
     * The worktree is on a branch this record does not name.
     *
     * Carried as the branch rather than a flag, because every reader of it needs
     * to say which one — a row with no room for the reason still has room for
     * `on feat/something`. Null is the ordinary case.
     */
    const driftedTo = checkoutDrifted({
      recorded: session.branch,
      actual: worktree.branch,
      detached: session.detached,
    })
      ? worktree.branch
      : null

    return {
      ...session,
      worktree,
      checkStale: settled ? isStale(session.check, fingerprint ?? '') : false,
      activity,
      driftedTo,
      /**
       * Its work is in the base branch: finished, whatever else the row says.
       *
       * Both the filed landing and what git says right now, because neither
       * alone is enough — see `landedInBase`, which holds the reasoning and the
       * reason the drift guard applies to only one of them.
       */
      landed: landedInBase({
        recorded: session.landed,
        branch: session.branch,
        ahead: worktree.ahead,
        merged: mergedByRepo.get(session.repoDir) ?? new Set(),
        drifted: Boolean(driftedTo),
      }),
      pendingPermissions: pending,
      lastRunId,
      turnCount: session.runIds.length,
      // Everything is returned so nothing is silently hidden, but the caller is
      // told which belong to the folder currently selected.
      inCurrentProject: !projectDir || session.repoDir === projectDir,
    }
  })

  /**
   * Which sessions are changing the same files as which.
   *
   * Computed here rather than in the browser, and its input dropped rather than
   * sent. The paths were read for the changed-files count either way, so the
   * comparison is free — but twenty sessions with two hundred paths each is a
   * poll response nobody needs, and the answer is three lines long.
   *
   * After `landed` is decided, because a session whose work is in cannot collide
   * with anything and would otherwise be the most-overlapping row on the page.
   */
  const overlaps = findOverlaps(rows)

  return rows.map(({ worktree, ...row }) => {
    const { changedPaths: _dropped, ...rest } = worktree
    return {
      ...row,
      worktree: rest,
      /** Absent when nothing else touches these files, which is the usual case. */
      overlaps: overlaps.get(row.id),
    }
  })
})
