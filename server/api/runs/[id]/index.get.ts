import { readRun } from '../../../utils/runStore'
import { rulesDirFor } from '../../../utils/ruleScope'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const run = await readRun(id)

  if (!run) {
    throw createError({ statusCode: 404, message: `Run not found: ${id}` })
  }

  // Resolved here rather than in the browser, because telling a worktree from
  // the repository it belongs to needs the session record.
  return { ...run, rulesDir: await rulesDirFor(run) }
})
