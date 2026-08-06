import { getProjectDir } from '../../utils/scope'
import { readSessions } from '../../utils/sessions'
import { worktreeStatus } from '../../utils/worktrees'
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

    return {
      ...session,
      worktree,
      activity,
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
