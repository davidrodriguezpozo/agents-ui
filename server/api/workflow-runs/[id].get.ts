import { findWorkflowRun } from '../../utils/workflowRuns'
import { readRun, getActive } from '../../utils/runStore'

/**
 * How a workflow run is going, with each step's run alongside it.
 *
 * The steps carry their own output and cost because they are ordinary runs —
 * so this is a join rather than a second copy of anything, and a step can also
 * be opened in Activity like any other run.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const run = await findWorkflowRun(id)
  if (!run) throw createError({ statusCode: 404, message: `Workflow run not found: ${id}` })

  const steps = await Promise.all(run.steps.map(async (step) => {
    const detail = getActive(step.runId)?.run ?? await readRun(step.runId)
    return {
      ...step,
      status: detail?.status ?? 'queued',
      output: detail?.output ?? '',
      error: detail?.error,
      costUsd: detail?.stats?.costUsd,
      durationMs: detail?.completedAt && detail?.startedAt
        ? detail.completedAt - detail.startedAt
        : undefined,
    }
  }))

  return { ...run, steps }
})
