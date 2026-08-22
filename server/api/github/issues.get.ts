import { getProjectDir } from '../../utils/scope'
import { readIntake } from '../../utils/issues'
import { readPreferences } from '../../utils/preferences'

/**
 * Everything that has been asked of you: the issues in this project, and the
 * Notion tickets an agent has been told it may take.
 *
 * The GitHub half is read on demand, exactly like `/api/github/pulls` beside it:
 * an assignee changes, somebody replies, a session takes the branch, and a cached
 * answer to any of those is worse than a slow one. It costs three `gh` calls,
 * which is roughly a second; the page says when it last asked.
 *
 * The Notion half is *not* read here. Asking Notion is a model run costing tens
 * of seconds — see `notionIntake.ts` — and this route answers a two-minute poll,
 * so the tickets come out of a store that `/api/notion/refresh` fills. That is
 * the difference between a band that stays open all day and a band that bills you
 * for it.
 *
 * Both settings come from preferences rather than the query string. They are
 * properties of how this machine works — the same label an `issue_labelled`
 * ritual fires on, and the status value a team agreed on — not of whoever is
 * drawing the band.
 *
 * **The route keeps its name.** It was `github/issues` when the band had one
 * source, and the band now has two; renaming it would move the file brief 09 is
 * about to extend for the sake of a nicer word. What it returns says which
 * tracker each row came from, which is the part that has to be honest.
 */
export default defineEventHandler(async (event) => {
  const repoDir = (getQuery(event).repoDir as string) || getProjectDir(event)
  const { issueLabel, notionIntake } = await readPreferences()
  return readIntake(repoDir, issueLabel, notionIntake)
})
