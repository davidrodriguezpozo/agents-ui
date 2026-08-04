import { getProjectDir } from '../../utils/scope'
import { readSessions, saveSession, type Session } from '../../utils/sessions'
import { inspectForRecovery, recoveredSessionFrom } from '../../utils/sessionRecovery'
import {
  canonicalPath, isGitRepo, listWorktrees, looksLikeSessionWorktree, worktreeRootFor,
} from '../../utils/worktrees'

/**
 * Rebuild session records for worktrees that lost theirs.
 *
 * The session index is a single file; a damaged or deleted one would otherwise
 * strand real work behind a "no session" label whose only offered action is
 * deletion. Everything needed to reconstruct the record survives in git and in
 * the transcript, including the SDK session id — so a restored session resumes
 * the conversation rather than starting a new one.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ repoDir?: string; paths?: string[] }>(event)
  const repoDir = body?.repoDir || getProjectDir(event)

  if (!repoDir || !(await isGitRepo(repoDir))) {
    throw createError({
      statusCode: 400,
      data: { error: 'not_a_repo', message: 'No git repository selected.' },
    })
  }

  const [worktrees, sessions] = await Promise.all([listWorktrees(repoDir), readSessions()])
  const claimed = new Set(await Promise.all(sessions.map(s => canonicalPath(s.worktreePath))))
  const wanted = body?.paths?.length ? new Set(body.paths) : null

  const worktreeRoot = await canonicalPath(worktreeRootFor(repoDir))

  const candidates = (await Promise.all(
    worktrees
      .filter(w => !wanted || wanted.has(w.path))
      .map(async w => ({ worktree: w, canonical: await canonicalPath(w.path) })),
  )).filter(({ worktree, canonical }) =>
    looksLikeSessionWorktree(worktreeRoot, { canonical, branch: worktree.branch }),
  )

  const recovered: Session[] = []
  const skipped: { path: string; reason: string }[] = []

  for (const { worktree, canonical } of candidates) {
    if (claimed.has(canonical)) {
      skipped.push({ path: worktree.path, reason: 'Already has a session.' })
      continue
    }

    // Git still tracks it but the directory is gone: there is nothing to work
    // in, so a record would only point at emptiness.
    const candidate = await inspectForRecovery(worktree.path, worktree.branch!)
    if (!candidate.exists) {
      skipped.push({ path: worktree.path, reason: 'Its directory no longer exists.' })
      continue
    }

    recovered.push(await saveSession(await recoveredSessionFrom(repoDir, candidate)))
  }

  return { recovered, skipped }
})
