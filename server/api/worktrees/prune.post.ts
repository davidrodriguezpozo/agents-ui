import { getProjectDir } from '../../utils/scope'
import { readSessions } from '../../utils/sessions'
import { deleteBranch, isGitRepo, listWorktrees, pruneWorktrees, removeWorktree } from '../../utils/worktrees'

/**
 * Clean up worktrees this app made that no longer have a session behind them.
 *
 * Only touches paths git reports and branches under `agents-ui/`, so a
 * worktree someone made by hand is never removed. Uncommitted work still
 * blocks removal unless explicitly forced.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ repoDir?: string; paths?: string[]; force?: boolean }>(event)
  const repoDir = body?.repoDir || getProjectDir(event)

  if (!repoDir || !(await isGitRepo(repoDir))) {
    throw createError({ statusCode: 400, message: 'No git repository selected.' })
  }

  const [worktrees, sessions] = await Promise.all([listWorktrees(repoDir), readSessions()])
  const claimed = new Set(sessions.map(s => s.worktreePath))

  const candidates = worktrees.filter(w =>
    w.path !== repoDir
    && !claimed.has(w.path)
    && Boolean(w.branch?.startsWith('agents-ui/'))
    && (!body?.paths?.length || body.paths.includes(w.path))
  )

  const removed: string[] = []
  const failed: { path: string; reason: string }[] = []

  for (const worktree of candidates) {
    try {
      await removeWorktree(repoDir, worktree.path, { force: body?.force })
      if (worktree.branch) await deleteBranch(repoDir, worktree.branch)
      removed.push(worktree.path)
    } catch (e: any) {
      failed.push({ path: worktree.path, reason: e?.data?.message || e?.message || 'Unknown error' })
    }
  }

  await pruneWorktrees(repoDir)
  return { removed, failed }
})
