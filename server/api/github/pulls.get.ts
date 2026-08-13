import { getProjectDir } from '../../utils/scope'
import { readPulls } from '../../utils/reviews'

/**
 * The pull requests with your name on them, in the selected project.
 *
 * Read on demand rather than cached, because everything on it is a claim about
 * right now — a check that has gone green since, a review that has landed — and
 * a stale one is worse than a slow one. It costs two `gh` calls and a GraphQL
 * query, which is roughly a second; the page says when it last asked.
 */
export default defineEventHandler(async (event) => {
  const repoDir = (getQuery(event).repoDir as string) || getProjectDir(event)
  return readPulls(repoDir)
})
