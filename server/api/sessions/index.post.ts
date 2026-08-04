import { getProjectDir } from '../../utils/scope'
import { startSession } from '../../utils/startSession'

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

  return startSession({
    repoDir,
    title: body?.title || 'Untitled session',
    agentSlug: body?.agentSlug,
    baseRef: body?.baseRef,
  })
})
