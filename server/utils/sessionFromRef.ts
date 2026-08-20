import { findBranchHolder } from './branchHolder'
import { newSessionId, saveSession, type Session } from './sessions'
import {
  createDetachedWorktree,
  createWorktreeOn,
  currentBranch,
  fastForward,
  fetchRemoteBranchHead,
  hasCommits,
  isGitRepo,
  isWorktreeDirty,
  resolveRef,
  worktreePathFor,
} from './worktrees'
import {
  defaultRemote,
  fetchPullRequestBranch,
  fetchPullRequestHead,
  parseStartRef,
  resolvePullRequest,
} from './pullRequest'

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
 *
 * Two things here exist because starting on existing work a *second* time used
 * to be a dead end — "fatal: branch X is already checked out at Y", which is
 * true and useless, since the thing you asked for is sitting in that directory:
 *
 *   - `detach` takes the commit instead of the branch. A review neither commits
 *     nor pushes, so paying a branch for it was buying nothing and costing the
 *     ability to do it twice, or at all while a session works that branch.
 *   - Everything else asks `findBranchHolder` first, and continues or takes over
 *     the workspace that already has the branch rather than failing next to it.
 */

export interface StartedFromRef {
  session: Session
  /**
   * Where the workspace came from. The caller says this out loud, because
   * "continued" and "created" look identical afterwards and are not the same
   * news — one of them means your instruction landed in a conversation that
   * already has history.
   */
  how: 'created' | 'continued' | 'adopted'
  /** Anything else worth telling the person, in a sentence. */
  note?: string
}

export async function startSessionFromRef(options: {
  repoDir: string
  ref: string
  agentSlug?: string
  /** Overrides the title derived from the ref, for a caller with a better one. */
  title?: string
  /**
   * Check out the commit rather than the branch, for work that only reads.
   * Nothing about such a session touches a ref, so any number of them can look
   * at the same pull request at once — and none of them takes the branch away
   * from a session that is changing it.
   */
  detach?: boolean
}): Promise<StartedFromRef> {
  const { repoDir, detach } = options

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
  let prNumber: number | undefined
  /** GitHub's answer for the head commit, which beats reading `FETCH_HEAD`. */
  let prHead: string | undefined

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
    prNumber = pr.number
    prHead = pr.headSha || undefined
  }

  const record: Draft = {
    title: options.title?.trim() || title,
    repoDir,
    branch,
    baseBranch,
    agentSlug: options.agentSlug,
    prUrl,
  }

  if (detach) {
    return {
      session: await saveSession(await detachedSession(record, { remote, prNumber, prHead })),
      how: 'created',
    }
  }

  if (parsed.kind === 'pr') {
    await fetchPullRequestBranch(repoDir, remote!, prNumber!, branch)
  }

  const holder = await findBranchHolder(repoDir, branch)

  if (holder.kind === 'busy') {
    throw createError({
      statusCode: 409,
      data: {
        error: 'session_running',
        sessionId: holder.session.id,
        message: `\`${branch}\` is checked out in a session that is working right now — "${holder.session.title}". `
          + 'Open it and say what you need there, rather than starting a second one on the same branch.',
      },
    })
  }

  // The session on this branch already exists, so this is that session. A new
  // record pointed at the same directory would be two conversations editing one
  // workspace, which is worse than the error this replaces.
  if (holder.kind === 'session') {
    const moved = await catchUp(holder.session.worktreePath, { remote, branch, prNumber, prHead })
    return {
      session: holder.session,
      how: 'continued',
      note: moved ? `Brought \`${branch}\` up to date first.` : undefined,
    }
  }

  if (holder.kind === 'foreign') {
    throw createError({
      statusCode: 409,
      data: {
        error: 'branch_in_use',
        message: `\`${branch}\` is checked out in ${holder.path}, which is not a workspace this app made — `
          + 'quite possibly your own. A branch can only be in one working copy at a time, so switch that one '
          + 'away first and I will not touch it.',
      },
    })
  }

  if (holder.kind === 'adoptable') {
    return adopt(holder.path, record, { remote, prNumber, prHead })
  }

  const id = newSessionId()
  const { path, baseSha } = await createWorktreeOn({
    repoDir,
    path: worktreePathFor(repoDir, id),
    branch,
    remote,
  })

  return {
    session: await saveSession(stamp(id, record, {
      worktreePath: path,
      // The branch as it stands now, so the diff is this session's work alone.
      baseSha,
      borrowedBranch: true,
    })),
    how: 'created',
  }
}

type Draft = {
  title: string
  repoDir: string
  branch: string
  baseBranch: string
  agentSlug?: string
  prUrl?: string
}

function stamp(id: string, record: Draft, rest: Partial<Session> & { worktreePath: string; baseSha: string }): Session {
  const now = Date.now()
  return {
    id,
    ...record,
    status: 'idle',
    runIds: [],
    createdAt: now,
    updatedAt: now,
    ...rest,
  }
}

/**
 * A workspace with the pull request's commit in it and no branch.
 *
 * The commit is fetched through `pull/N/head` rather than by branch, so this
 * works on a fork and so nothing creates or moves a local ref on the way. For a
 * plain branch ref the local branch is used when there is one and the
 * remote-tracking ref otherwise — read, in both cases, never checked out.
 */
async function detachedSession(
  record: Draft,
  context: { remote: string | null; prNumber?: number; prHead?: string },
): Promise<Session> {
  const { repoDir, branch } = record
  const { remote, prNumber, prHead } = context

  let commit = ''

  if (prNumber !== undefined && remote) {
    commit = await fetchPullRequestHead(repoDir, remote, prNumber, prHead)
  } else {
    // A local branch is the commit somebody means when they type a branch name
    // they have; the remote is where the rest come from.
    commit = await resolveRef(repoDir, `refs/heads/${branch}`)
    if (!commit && remote) commit = await fetchRemoteBranchHead(repoDir, remote, branch)

    if (!commit) {
      throw createError({
        statusCode: 404,
        data: {
          error: 'no_such_branch',
          message: `There is no branch called \`${branch}\` here${remote ? ` or on ${remote}` : ''}.`,
        },
      })
    }
  }

  const id = newSessionId()
  const { path, head } = await createDetachedWorktree({
    repoDir,
    path: worktreePathFor(repoDir, id),
    commit,
  })

  return stamp(id, record, {
    worktreePath: path,
    baseSha: head,
    detached: true,
    // No branch is checked out here, so there is certainly none to delete.
    borrowedBranch: true,
    // Recorded here rather than by the caller, because this is the only place
    // that knows both facts at once: which pull request was asked for, and which
    // commit actually landed in the workspace. GitHub's answer and the checkout
    // can differ by a push that happened in between, and the findings will be
    // about the one on disk.
    ...(prNumber !== undefined ? { reviewOf: { number: prNumber, headSha: head, url: record.prUrl } } : {}),
  })
}

/**
 * Take over a workspace of ours that no session claims.
 *
 * A record deleted from under a worktree, a crash between the two writes, a
 * recovery that got half way. The directory has the branch, the branch is the
 * one being asked for, and nothing is using it — so the answer is to reuse it
 * rather than to report a collision with a ghost.
 *
 * Uncommitted work in there is the one thing that stops this. It is somebody's,
 * it is not recorded anywhere, and adopting the directory would put an agent on
 * top of it.
 */
async function adopt(
  path: string,
  record: Draft,
  context: { remote: string | null; prNumber?: number; prHead?: string },
): Promise<StartedFromRef> {
  if (await isWorktreeDirty(path)) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'worktree_dirty',
        message: `\`${record.branch}\` is checked out in ${path}, a workspace no session claims, and it has `
          + 'uncommitted changes in it. Nothing here will write on top of those — look at them first, from '
          + 'the worktrees panel in settings.',
      },
    })
  }

  const moved = await catchUp(path, { ...context, branch: record.branch })
  const baseSha = await resolveRef(path, 'HEAD')

  return {
    session: await saveSession(stamp(newSessionId(), record, {
      worktreePath: path,
      baseSha,
      borrowedBranch: true,
      recoveredAt: Date.now(),
    })),
    how: 'adopted',
    note: moved
      ? 'Took over a workspace that already had this branch, and brought it up to date.'
      : 'Took over a workspace that already had this branch.',
  }
}

/**
 * Bring a reused workspace forward to what the remote has, if it costs nothing.
 *
 * The reason to bother: coming back to a pull request a day later means the
 * author has probably pushed since, and continuing in a workspace that is three
 * commits behind produces a session confidently working on a version of the
 * change nobody is looking at any more.
 *
 * Best effort by design. `--ff-only` refuses the moment there is anything to
 * decide — local commits, a rewritten branch, uncommitted work — and refusing
 * is correct: none of those are questions to answer silently on the way to
 * starting a session.
 */
async function catchUp(
  path: string,
  context: { remote: string | null; branch: string; prNumber?: number; prHead?: string },
): Promise<boolean> {
  const { remote, branch, prNumber, prHead } = context
  if (!remote) return false

  if (prNumber !== undefined) {
    const head = await fetchPullRequestHead(path, remote, prNumber, prHead).catch(() => '')
    return head ? fastForward(path, head) : false
  }

  return fastForward(path, `${remote}/${branch}`)
}
