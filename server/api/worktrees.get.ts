import { homedir } from 'node:os'
import { getProjectDir } from '../utils/scope'
import { readSessions } from '../utils/sessions'
import { inspectForRecovery } from '../utils/sessionRecovery'
import {
  canonicalPath,
  isGitRepo,
  listWorktrees,
  looksLikeSessionWorktree,
  unmergedCommits,
  worktreeRootFor,
} from '../utils/worktrees'

/**
 * Every worktree git knows about, cross-referenced with our sessions.
 *
 * Read from git rather than from our own records on purpose: worktrees are easy
 * to lose track of, and the ones that matter most are the ones we *don't* have
 * a session for — left behind by a crash, or by a damaged session index. Those
 * carry what it would take to rebuild the session, because restoring one is
 * almost always the right answer and deleting it is almost always the wrong one.
 */
export default defineEventHandler(async (event) => {
  const repoDir = (getQuery(event).repoDir as string) || getProjectDir(event)

  if (!repoDir || !(await isGitRepo(repoDir))) {
    return { repoDir: repoDir ?? null, isRepo: false, worktrees: [], root: null, home: homedir() }
  }

  const [worktrees, sessions] = await Promise.all([listWorktrees(repoDir), readSessions()])

  // Match on resolved paths: git resolves symlinks and we do not, so comparing
  // the raw strings would report live sessions as abandoned.
  const [sessionPaths, worktreePaths, canonicalRepoDir, worktreeRoot] = await Promise.all([
    Promise.all(sessions.map(s => canonicalPath(s.worktreePath))),
    Promise.all(worktrees.map(w => canonicalPath(w.path))),
    canonicalPath(repoDir),
    canonicalPath(worktreeRootFor(repoDir)),
  ])
  const byPath = new Map(sessionPaths.map((path, i) => [path, sessions[i]!]))

  const entries = await Promise.all(worktrees.map(async (worktree, i) => {
    const canonical = worktreePaths[i]!
    const session = byPath.get(canonical)
    const isMain = canonical === canonicalRepoDir

    // Ours by where it sits, but with no session behind it.
    const orphaned = !session && !isMain
      && looksLikeSessionWorktree(worktreeRoot, { canonical, branch: worktree.branch })

    return {
      ...worktree,
      isMain,
      sessionId: session?.id ?? null,
      sessionTitle: session?.title ?? null,
      orphaned,
      // What restoring it would bring back, and what deleting it would cost.
      recovery: orphaned && worktree.branch
        ? {
            ...(await inspectForRecovery(worktree.path, worktree.branch)),
            unmergedCommits: await unmergedCommits(repoDir, worktree.branch),
          }
        : null,
    }
  }))

  return {
    repoDir,
    isRepo: true,
    root: worktreeRootFor(repoDir),
    // So the UI can shorten paths to `~/…` without guessing where home is.
    home: homedir(),
    worktrees: entries,
  }
})
