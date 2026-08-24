import { readRun } from '../../../utils/runStore'
import { rulesDirFor } from '../../../utils/ruleScope'
import { capabilitiesOf } from '../../../utils/providers'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const run = await readRun(id)

  if (!run) {
    throw createError({ statusCode: 404, message: `Run not found: ${id}` })
  }

  return {
    ...run,
    // Resolved here rather than in the browser, because telling a worktree from
    // the repository it belongs to needs the session record.
    rulesDir: await rulesDirFor(run),
    /**
     * What the agent that ran this can do, sent rather than inferred.
     *
     * The page has to be able to say "no cost reported" instead of showing a
     * blank where a figure goes, and the only honest source for that is the
     * provider itself. Answering it in the browser would mean a second copy of
     * the capability table, and the copy that drifts is always the far one.
     */
    capabilities: capabilitiesOf(run.provider),
  }
})
