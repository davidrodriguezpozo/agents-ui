import { getProjectDir } from '../../utils/scope'
import { readSessions } from '../../utils/sessions'
import {
  canonicalPath,
  deleteBranch,
  isGitRepo,
  listWorktrees,
  looksLikeSessionWorktree,
  pruneWorktrees,
  removeWorktree,
  unmergedCommits,
  worktreeRootFor,
} from '../../utils/worktrees'

/**
 * Clean up worktrees this app made that no longer have a session behind them.
 *
 * Only touches paths git reports that sit inside this repository's
 * `.worktrees/` directory, so a worktree someone made by hand is never
 * removed. Two things block removal unless
 * explicitly forced: uncommitted changes in the directory, and commits on the
 * branch that exist nowhere else. The second matters most — the branch is
 * deleted with `-D`, so without the check a single "clean up" click could
 * discard finished work whose only fault was losing its session record.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ repoDir?: string; paths?: string[]; force?: boolean }>(event)
  const repoDir = body?.repoDir || getProjectDir(event)

  if (!repoDir || !(await isGitRepo(repoDir))) {
    throw createError({ statusCode: 400, message: 'No git repository selected.' })
  }

  const [worktrees, sessions] = await Promise.all([listWorktrees(repoDir), readSessions()])
  const claimed = new Set(await Promise.all(sessions.map(s => canonicalPath(s.worktreePath))))
  const [canonicalRepoDir, worktreeRoot] = await Promise.all([
    canonicalPath(repoDir),
    canonicalPath(worktreeRootFor(repoDir)),
  ])

  const resolved = await Promise.all(
    worktrees.map(async w => ({ ...w, canonical: await canonicalPath(w.path) })),
  )

  const candidates = resolved.filter(w =>
    w.canonical !== canonicalRepoDir
    && !claimed.has(w.canonical)
    && looksLikeSessionWorktree(worktreeRoot, w)
    && (!body?.paths?.length || body.paths.includes(w.path))
  )

  const removed: string[] = []
  const failed: { path: string; reason: string }[] = []

  for (const worktree of candidates) {
    const commits = worktree.branch ? await unmergedCommits(repoDir, worktree.branch) : 0

    if (commits && !body?.force) {
      failed.push({
        path: worktree.path,
        reason: `It has ${commits} commit${commits === 1 ? '' : 's'} that ${commits === 1 ? 'exists' : 'exist'} nowhere else. `
          + 'Restore it as a session to keep that work, or remove it anyway.',
      })
      continue
    }

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
