import { getProjectDir } from '../../utils/scope'
import { readIssues } from '../../utils/issues'
import { readPreferences } from '../../utils/preferences'

/**
 * The issues that are yours to pick up, in the selected project.
 *
 * Read on demand rather than held, exactly like `/api/github/pulls` beside it:
 * an assignee changes, somebody replies, a session takes the branch, and a
 * cached answer to any of those is worse than a slow one. It costs three `gh`
 * calls, which is roughly a second; the page says when it last asked.
 *
 * The label comes from preferences rather than the query string. It is a
 * property of how this machine works — the same word `issue_labelled` rituals
 * fire on — not of whoever is drawing the band.
 */
export default defineEventHandler(async (event) => {
  const repoDir = (getQuery(event).repoDir as string) || getProjectDir(event)
  const { issueLabel } = await readPreferences()
  return readIssues(repoDir, issueLabel)
})
