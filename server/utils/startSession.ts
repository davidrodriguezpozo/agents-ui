import { basename } from 'node:path'
import { newSessionId, saveSession, type Session } from './sessions'
import {
  branchNameFor,
  createWorktree,
  currentBranch,
  hasCommits,
  isGitRepo,
  worktreePathFor,
} from './worktrees'

/**
 * Cut a branch and an isolated worktree, and record the session that owns them.
 *
 * Shared by starting a session from scratch and by adopting one from the
 * terminal, because the two must produce the same thing: a session adopted
 * from a CLI conversation is an ordinary session that happens to remember an
 * earlier conversation.
 */
export async function startSession(options: {
  repoDir: string
  title: string
  agentSlug?: string
  baseRef?: string
  /** Set when continuing an existing conversation rather than beginning one. */
  sdkSessionId?: string
  adoptedAt?: number
}): Promise<Session> {
  const { repoDir } = options

  if (!(await isGitRepo(repoDir))) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'not_a_repo',
        message: `${basename(repoDir)} is not a git repository, so it cannot be branched for parallel work.`,
      },
    })
  }

  // A session is a branch and a checkout, and neither can exist before there is
  // a commit to cut them from. Said here, where it is still a sentence about
  // your repository, rather than leaking out of git as an invalid object name.
  if (!(await hasCommits(repoDir))) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'no_commits',
        message: `${basename(repoDir)} has no commits yet, and a session needs one to branch from. `
          + 'Make the first commit — even an empty one — and it will work from there.',
      },
    })
  }

  const id = newSessionId()
  const title = options.title.trim() || 'Untitled session'
  const baseBranch = options.baseRef?.trim() || await currentBranch(repoDir)
  const branch = branchNameFor(title, id)

  const { path, baseSha } = await createWorktree({
    repoDir,
    path: worktreePathFor(repoDir, id),
    branch,
    baseRef: baseBranch,
  })

  const now = Date.now()

  return saveSession({
    id,
    title,
    repoDir,
    worktreePath: path,
    branch,
    baseBranch,
    baseSha,
    status: 'idle',
    agentSlug: options.agentSlug,
    sdkSessionId: options.sdkSessionId,
    runIds: [],
    createdAt: now,
    updatedAt: now,
    adoptedAt: options.adoptedAt,
  })
}
