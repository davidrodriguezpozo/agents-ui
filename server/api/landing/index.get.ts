import { getProjectDir } from '../../utils/scope'
import { readLandingRuns } from '../../utils/landingRuns'

/** Landing runs for this project, newest first, so a page can follow one. */
export default defineEventHandler(async (event) => {
  const repoDir = getProjectDir(event)
  const runs = await readLandingRuns()

  return { runs: repoDir ? runs.filter(r => r.repoDir === repoDir) : runs }
})
