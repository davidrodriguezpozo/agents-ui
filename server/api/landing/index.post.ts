import { getProjectDir } from '../../utils/scope'
import { currentBranch, isGitRepo } from '../../utils/worktrees'
import { startLanding } from '../../utils/lander'

/**
 * Land the finished sessions in this project, one after another.
 *
 * The base branch is read from the checkout rather than taken from the caller:
 * merges go into whatever you actually have checked out, and letting a request
 * name a different branch would be a way to merge somewhere you are not
 * looking.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ dir?: string }>(event).catch(() => ({} as { dir?: string }))
  const repoDir = body?.dir || getProjectDir(event)

  if (!repoDir) {
    throw createError({ statusCode: 400, data: { error: 'no_project', message: 'Pick a project first.' } })
  }
  if (!await isGitRepo(repoDir)) {
    throw createError({
      statusCode: 400,
      data: { error: 'not_a_repo', message: 'This project is not a git repository, so there is nothing to merge into.' },
    })
  }

  return startLanding(repoDir, await currentBranch(repoDir))
})
