import { getProjectDir } from '../../utils/scope'
import { readSessions } from '../../utils/sessions'
import { mapLimit } from '../../utils/pool'
import { worktreeStates } from '../../utils/worktreeStates'
import { mergedBranches } from '../../utils/merge'
import { hasLanded } from '../../utils/lander'
import { isStale } from '../../utils/checks'
import { getActive, readRun } from '../../utils/runStore'
import { listPending } from '../../utils/permissionBroker'

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

  return sessions.map((session, index) => {
    const { status: worktree, fingerprint } = states[index]!
    const { lastRunId, status, pending } = runs[index]!

    let activity: SessionActivity = 'idle'
    if (!worktree.exists) activity = 'missing'
    else if (pending) activity = 'awaiting-permission'
    else if (status === 'running' || status === 'queued') activity = 'working'
    else if (status === 'failed') activity = 'failed'

    // Only for a session with a settled verdict to be stale, and never mid-turn.
    const settled = session.check && session.check.status !== 'running' && activity === 'idle'

    return {
      ...session,
      worktree,
      checkStale: settled ? isStale(session.check, fingerprint ?? '') : false,
      activity,
      /** Its work is in the base branch: finished, whatever else the row says. */
      landed: hasLanded(session.branch, worktree.ahead, mergedByRepo.get(session.repoDir) ?? new Set()),
      pendingPermissions: pending,
      lastRunId,
      turnCount: session.runIds.length,
      // Everything is returned so nothing is silently hidden, but the caller is
      // told which belong to the folder currently selected.
      inCurrentProject: !projectDir || session.repoDir === projectDir,
    }
  })
})
