import { basename } from 'node:path'
import { addProject } from './projects'
import { newSessionId, saveSession, type Session } from './sessions'
import type { TrustLevel } from './trust'
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
  /**
   * How much this session may do without asking, chosen before it starts.
   *
   * Rituals have always decided this up front. Sessions could only be changed
   * after the fact, which meant the *first* turn — usually the longest, and the
   * one somebody most wants to leave running — ignored the intent entirely.
   */
  trust?: TrustLevel
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

  // A repository worth branching is a project worth listing. Added rather than
  // activated: this can be reached from a session started against a path that
  // came from somewhere else, and moving what the person is looking at is not
  // part of what they asked for.
  await addProject(repoDir).catch(() => {})

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
    // Absent means the default, which is what every session had before this
    // could be chosen up front.
    trust: options.trust,
    sdkSessionId: options.sdkSessionId,
    runIds: [],
    createdAt: now,
    updatedAt: now,
    adoptedAt: options.adoptedAt,
  })
}
