import { getProjectDir } from '../../../utils/scope'
import { readThreads } from '../../../utils/reviews'

/**
 * What the unresolved threads on one pull request actually say.
 *
 * On demand, for one pull request, when a row is expanded — never while the list
 * is drawn. The list's counts are cheap on purpose; this is the question you ask
 * about the one you have decided to look at, and asking it for eight at once is
 * what made the bodies unaffordable in the first place.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const number = Number(query.number)
  const repoDir = (query.repoDir as string) || getProjectDir(event)

  if (!Number.isInteger(number) || number <= 0) {
    throw createError({ statusCode: 400, data: { error: 'no_number', message: 'Which pull request?' } })
  }

  if (!repoDir) {
    throw createError({ statusCode: 400, data: { error: 'no_project', message: 'Pick a project folder first.' } })
  }

  return readThreads(repoDir, number)
})
