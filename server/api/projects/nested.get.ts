import { findRepositoriesIn } from '../../utils/nestedRepos'
import { normaliseProjectPath } from '../../utils/projects'

/**
 * Repositories sitting inside a folder that is not one itself.
 *
 * Asked for only when a project turns out not to be a repository, so the cost
 * of the scan is paid by the case that needs it rather than by every listing.
 */
export default defineEventHandler(async (event) => {
  const dir = normaliseProjectPath(String(getQuery(event).dir ?? ''))
  if (!dir) {
    throw createError({ statusCode: 400, message: 'A directory is required' })
  }

  return { dir, repos: await findRepositoriesIn(dir) }
})
