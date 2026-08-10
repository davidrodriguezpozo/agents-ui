import { getProjectDir } from '../../utils/scope'
import { candidatesIn } from '../../utils/lander'
import { planLanding } from '../../utils/landing'

/**
 * What landing would do, without doing it.
 *
 * The same `planLanding` the POST runs, over the same freshly-read worktree
 * state — so the order the merge train draws is the order that will actually be
 * attempted, and the count it prints agrees with the button beside it. A client
 * that re-derived "could this land" from the session list would drift from these
 * rules the first time either side changed, and the drift would be invisible:
 * both numbers look plausible, only one of them is right.
 */
export default defineEventHandler(async (event) => {
  const repoDir = getProjectDir(event)

  // No project selected means no base branch to land into, so there is no plan
  // rather than an empty one — the difference the page needs to say nothing.
  if (!repoDir) return { repoDir: null, queue: [], skipped: [] }

  const plan = planLanding(await candidatesIn(repoDir))

  return { repoDir, ...plan }
})
