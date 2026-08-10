import { getProjectDir } from '../../utils/scope'
import { readSessions } from '../../utils/sessions'
import { worktreeStatus } from '../../utils/worktrees'
import { mergedBranches } from '../../utils/merge'
import { hasLanded } from '../../utils/lander'
import { isStale, worktreeFingerprint } from '../../utils/checks'
import { getActive, readRun } from '../../utils/runStore'
import { listPending } from '../../utils/permissionBroker'

/**
 * Sessions with the live state of their worktree and their current run.
 *
 * "Running" is not enough to act on: a session waiting for a permission answer
 * looks identical to one that is working, and only one of them needs you. The
 * activity field distinguishes them so the list can say which is which.
 */
export type SessionActivity = 'idle' | 'working' | 'awaiting-permission' | 'failed' | 'missing'

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

  const enriched = await Promise.all(sessions.map(async (session) => {
    const worktree = await worktreeStatus(session.worktreePath, session.baseSha || session.baseBranch, session.baseBranch)

    const lastRunId = session.runIds.at(-1)
    const lastRun = lastRunId ? getActive(lastRunId)?.run ?? await readRun(lastRunId) : null
    const pending = lastRunId ? listPending(lastRunId) : []

    let activity: SessionActivity = 'idle'
    if (!worktree.exists) activity = 'missing'
    else if (pending.length) activity = 'awaiting-permission'
    else if (lastRun?.status === 'running' || lastRun?.status === 'queued') activity = 'working'
    else if (lastRun?.status === 'failed') activity = 'failed'

    // Only for a session that has a settled verdict to be stale, and never
    // mid-turn. A fingerprint is a full `git diff HEAD`, so it is paid for
    // exactly where a misleading green is possible and nowhere else.
    const settled = session.check && session.check.status !== 'running' && activity === 'idle'
    const checkStale = settled
      ? isStale(session.check, await worktreeFingerprint(session.worktreePath))
      : false

    return {
      ...session,
      worktree,
      checkStale,
      activity,
      /** Its work is in the base branch: finished, whatever else the row says. */
      landed: hasLanded(session.branch, worktree.ahead, mergedByRepo.get(session.repoDir) ?? new Set()),
      pendingPermissions: pending.length,
      lastRunId: lastRunId ?? null,
      turnCount: session.runIds.length,
    }
  }))

  // Everything is returned so nothing is silently hidden, but the caller is
  // told which belong to the folder currently selected.
  return enriched.map(session => ({
    ...session,
    inCurrentProject: !projectDir || session.repoDir === projectDir,
  }))
})
