import { getProjectDir } from '../utils/scope'
import { readSessions } from '../utils/sessions'
import { isGitRepo, listWorktrees, worktreeRootFor } from '../utils/worktrees'

/**
 * Every worktree git knows about, cross-referenced with our sessions.
 *
 * Read from git rather than from our own records on purpose: worktrees are easy
 * to lose track of, and the ones that matter most are the ones we *don't* have
 * a session for — left behind by a crash, or created by hand. Those are shown
 * as orphans so they can be cleaned up rather than quietly accumulating.
 */
export default defineEventHandler(async (event) => {
  const repoDir = (getQuery(event).repoDir as string) || getProjectDir(event)

  if (!repoDir || !(await isGitRepo(repoDir))) {
    return { repoDir: repoDir ?? null, isRepo: false, worktrees: [], root: null }
  }

  const [worktrees, sessions] = await Promise.all([listWorktrees(repoDir), readSessions()])
  const byPath = new Map(sessions.map(s => [s.worktreePath, s]))

  return {
    repoDir,
    isRepo: true,
    root: worktreeRootFor(repoDir),
    worktrees: worktrees.map((worktree) => {
      const session = byPath.get(worktree.path)
      return {
        ...worktree,
        isMain: worktree.path === repoDir,
        sessionId: session?.id ?? null,
        sessionTitle: session?.title ?? null,
        // Ours by naming convention, but with no session behind it.
        orphaned: !session
          && worktree.path !== repoDir
          && Boolean(worktree.branch?.startsWith('agents-ui/')),
      }
    }),
  }
})
