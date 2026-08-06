import { runsForWorkflow } from '../../../utils/workflowRuns'

/**
 * What this workflow has done before, newest first.
 *
 * The question a workflow's page could never answer: it ran in the browser and
 * left nothing, so every visit looked like the first.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  return { runs: (await runsForWorkflow(slug)).slice(0, 20) }
})
