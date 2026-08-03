import { basename } from 'node:path'
import { getProjectDir } from '../../utils/scope'
import { newSessionId, saveSession, type Session } from '../../utils/sessions'
import {
  branchNameFor,
  createWorktree,
  currentBranch,
  isGitRepo,
  worktreePathFor,
} from '../../utils/worktrees'

/**
 * Start a session: cut a branch and an isolated worktree from the repo, so this
 * conversation can change files without colliding with anything else running.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ title?: string; repoDir?: string; agentSlug?: string; baseRef?: string }>(event)

  const repoDir = body?.repoDir || getProjectDir(event)
  if (!repoDir) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'no_project',
        message: 'Pick a project folder first — a session needs a repository to branch from.',
      },
    })
  }

  if (!(await isGitRepo(repoDir))) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'not_a_repo',
        message: `${basename(repoDir)} is not a git repository, so it cannot be branched for parallel work.`,
      },
    })
  }

  const id = newSessionId()
  const title = body?.title?.trim() || 'Untitled session'
  const baseBranch = body?.baseRef?.trim() || await currentBranch(repoDir)
  const branch = branchNameFor(title, id)

  const { path, baseSha } = await createWorktree({
    repoDir,
    path: worktreePathFor(repoDir, id),
    branch,
    baseRef: baseBranch,
  })

  const session: Session = {
    id,
    title,
    repoDir,
    worktreePath: path,
    branch,
    baseBranch,
    baseSha,
    status: 'idle',
    agentSlug: body?.agentSlug,
    runIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  return saveSession(session)
})
