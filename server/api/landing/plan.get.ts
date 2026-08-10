import { getProjectDir } from '../../utils/scope'
import { candidatesIn } from '../../utils/lander'
import { planLanding } from '../../utils/landing'
import { baseCheckoutState } from '../../utils/merge'
import { readSessions } from '../../utils/sessions'

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
  if (!repoDir) return { repoDir: null, queue: [], skipped: [], base: null }

  const candidates = await candidatesIn(repoDir)
  const plan = planLanding(candidates)

  /**
   * The branch these sessions expect to merge into, taken from the sessions
   * themselves rather than from the checkout — the whole question being asked is
   * whether the checkout is on the right one.
   */
  const sessions = (await readSessions()).filter(s => s.repoDir === repoDir)
  const baseBranch = sessions[0]?.baseBranch ?? null

  return {
    repoDir,
    ...plan,
    /**
     * Why nothing can land, when that is a fact about the repository rather than
     * about any one session. Surfaced here so the page can say so before
     * spending a test suite finding out.
     */
    base: baseBranch ? { baseBranch, ...(await baseCheckoutState(repoDir, baseBranch)) } : null,
  }
})
