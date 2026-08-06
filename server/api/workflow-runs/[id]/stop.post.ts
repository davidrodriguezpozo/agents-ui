import { cancel } from '../../../utils/runStore'
import { findWorkflowRun, patchWorkflowRun } from '../../../utils/workflowRuns'

/**
 * Stop a workflow part-way.
 *
 * Cancels the step in flight; the runner sees that and stops rather than
 * carrying on to the next one. Whatever the earlier steps produced stays —
 * stopping is not undoing, and those runs are in Activity like any other.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const run = await findWorkflowRun(id)
  if (!run) throw createError({ statusCode: 404, message: `Workflow run not found: ${id}` })

  if (run.status !== 'running') {
    return { ok: true, alreadyFinished: true }
  }

  // The last one on the list is the one in flight — steps are appended as they
  // start, so there is never more than one running.
  const current = run.steps.at(-1)
  if (current) cancel(current.runId)

  // Recorded here as well, rather than waiting for the runner to notice: if
  // the step had already finished, nothing would come along to write this.
  await patchWorkflowRun(id, { status: 'stopped', endedAt: Date.now() })

  return { ok: true }
})
