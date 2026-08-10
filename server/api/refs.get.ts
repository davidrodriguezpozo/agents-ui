import { getProjectDir } from '../utils/scope'
import { listBranches, listOpenPullRequests } from '../utils/gitRefs'

/**
 * What you could mean when a field asks for a branch or a pull request.
 *
 * Asked for both at once because the two places that need this need different
 * halves — a ritual's trigger filters by branch, a session starts from either —
 * and one request that answers both is cheaper than a field that has to know
 * which endpoint it is.
 *
 * Both halves fail independently. A repository with no GitHub remote still has
 * branches worth offering, and `gh` not being installed must not take the
 * branch list down with it.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const repoDir = (query.repoDir as string) || getProjectDir(event)

  if (!repoDir) return { branches: [], pullRequests: [], pullRequestsAsked: false }

  // `gh` leaves the machine and git does not, so the slow half never delays the
  // fast one. Asking for pull requests is opt-in: the ritual dialog only wants
  // branches, and there is no reason to spend a network round trip on it.
  const wantPulls = query.pulls !== '0'

  const [branches, pullRequests] = await Promise.all([
    listBranches(repoDir).catch(() => []),
    wantPulls ? listOpenPullRequests(repoDir).catch(() => null) : Promise.resolve(null),
  ])

  return {
    branches,
    pullRequests: pullRequests ?? [],
    /**
     * Whether the pull request list is a fact or a gap.
     *
     * Without this the field would say "no open pull requests" when `gh` is
     * simply not signed in, which is the kind of confident wrong answer that
     * teaches somebody to stop trusting the list.
     */
    pullRequestsAsked: wantPulls && pullRequests !== null,
  }
})
