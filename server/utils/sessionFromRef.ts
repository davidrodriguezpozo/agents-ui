import { newSessionId, saveSession, type Session } from './sessions'
import { createWorktreeOn, currentBranch, hasCommits, isGitRepo, worktreePathFor } from './worktrees'
import { defaultRemote, fetchPullRequestBranch, parseStartRef, resolvePullRequest } from './pullRequest'

/**
 * Start a session on work that already exists.
 *
 * Sessions have always begun by cutting a new branch, which is the right shape
 * for new work and the wrong one for most of it: continuing somebody's branch,
 * picking up a pull request, fixing a failing check. Those need the branch git
 * already has.
 *
 * The base recorded is the branch head at this moment, not the repository's
 * default — so the diff shows what this session does, rather than re-showing
 * everything the branch already contained.
 *
 * Lifted out of the endpoint it used to be, because the reviews page needs the
 * same thing and a second copy of it would be a second place for the fork
 * handling to be got subtly wrong.
 */
export async function startSessionFromRef(options: {
  repoDir: string
  ref: string
  agentSlug?: string
  /** Overrides the title derived from the ref, for a caller with a better one. */
  title?: string
}): Promise<Session> {
  const { repoDir } = options

  if (!(await isGitRepo(repoDir))) {
    throw createError({
      statusCode: 400,
      data: { error: 'not_a_repo', message: 'That folder is not a git repository.' },
    })
  }

  // Same trap as starting from scratch: with no commits the branch lookup
  // below yields the literal string "HEAD" and git rejects it further down,
  // by which point the error is about object names rather than about you.
  if (!(await hasCommits(repoDir))) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'no_commits',
        message: 'This repository has no commits yet, so there is no branch to work from. '
          + 'Make the first commit and try again.',
      },
    })
  }

  const parsed = parseStartRef(options.ref ?? '')
  if (!parsed) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_ref', message: 'Paste a pull request URL or type a branch name.' },
    })
  }

  const remote = await defaultRemote(repoDir)
  let branch = parsed.ref
  let title = `Work on ${parsed.ref}`
  let baseBranch = await currentBranch(repoDir)
  let prUrl: string | undefined

  if (parsed.kind === 'pr') {
    if (!remote) {
      throw createError({
        statusCode: 409,
        data: { error: 'no_remote', message: 'This repository has no remote, so a pull request cannot be fetched.' },
      })
    }

    const pr = await resolvePullRequest(repoDir, parsed.ref)
    branch = pr.headBranch
    title = `#${pr.number} ${pr.title}`
    baseBranch = pr.baseBranch
    prUrl = pr.url

    await fetchPullRequestBranch(repoDir, remote, pr.number, branch)
  }

  const id = newSessionId()
  const { path, baseSha } = await createWorktreeOn({
    repoDir,
    path: worktreePathFor(repoDir, id),
    branch,
    remote,
  })

  const now = Date.now()
  const session: Session = {
    id,
    title: options.title?.trim() || title,
    repoDir,
    worktreePath: path,
    branch,
    baseBranch,
    // The branch as it stands now, so the diff is this session's work alone.
    baseSha,
    status: 'idle',
    agentSlug: options.agentSlug,
    runIds: [],
    createdAt: now,
    updatedAt: now,
    prUrl,
  }

  return saveSession(session)
}
