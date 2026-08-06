import { runsForWorkflow } from '../../../utils/workflowRuns'
import { getActive, readRun } from '../../../utils/runStore'

/**
 * What this workflow has done before, newest first.
 *
 * The question a workflow's page could never answer: it ran in the browser and
 * left nothing, so every visit looked like the first.
 *
 * What it cost is joined from the step runs rather than stored twice. Without
 * it this is a list of timestamps, and the useful thing about a past run is
 * what it took to get it.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const runs = (await runsForWorkflow(slug)).slice(0, 20)

  return {
    runs: await Promise.all(runs.map(async (run) => {
      const costs = await Promise.all(run.steps.map(async (step) => {
        const detail = getActive(step.runId)?.run ?? await readRun(step.runId)
        return detail?.stats?.costUsd ?? 0
      }))

      return {
        ...run,
        costUsd: costs.reduce((total, cost) => total + cost, 0),
        durationMs: run.endedAt ? run.endedAt - run.startedAt : undefined,
      }
    })),
  }
})
