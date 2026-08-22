import { planBaseSweep } from '../../utils/baseSweeper'
import { readSessions } from '../../utils/sessions'
import { getProjectDir } from '../../utils/scope'

/**
 * Who would be brought forward, without bringing anybody forward.
 *
 * The offer that appears after a merge is drawn from this, and it is the same
 * `planSweep` the run itself uses — so the count in "bring the base into 3
 * others" is the count that will actually be attempted, and a session it cannot
 * touch is never in the number.
 *
 * Read on demand rather than after every merge: it is a `git` call per session
 * in the repository, which is cheap once and not cheap on a poll.
 */
export default defineEventHandler(async (event) => {
  const repoDir = (getQuery(event).dir as string) || getProjectDir(event)
  if (!repoDir) return { repoDir: null, baseBranch: null, candidates: [], updating: 0 }

  // The branch these sessions expect to merge into, taken from the sessions
  // rather than from the checkout — the same reasoning as the landing plan.
  const sessions = (await readSessions()).filter(session => session.repoDir === repoDir)
  const baseBranch = sessions[0]?.baseBranch

  if (!baseBranch) return { repoDir, baseBranch: null, candidates: [], updating: 0 }

  // The plan carries the base branch itself; spread last so there is one of it.
  return { ...(await planBaseSweep(repoDir, baseBranch)) }
})
