import type { Workflow } from '~/types'
import { resolveRunOptionsFor } from './runOptions'
import { createRun, getActive, readRun } from './runStore'
import { providerForProject } from './projectProvider'
import { executeRun } from './runner'
import { checkBudget } from './budget'
import { withRunSlot } from './runQueue'
import { notify } from './notify'
import {
  newWorkflowRunId, patchWorkflowRun, saveWorkflowRun,
  type WorkflowRun, type WorkflowStepRun,
} from './workflowRuns'

/**
 * Running a workflow, on this side of the wire.
 *
 * It used to run in the browser: a `fetch` per step from a composable, with the
 * results in a `ref`. That made a workflow the only thing here you had to
 * watch. Close the tab and it was gone — no record, nothing in Activity,
 * nothing on the spend page, and no limit could stop it because nothing knew
 * it was happening.
 *
 * Now each step is an ordinary run, which is the same thing a session turn and
 * a ritual are. Everything already built for runs — persistence, replay to
 * whoever attaches, cost, the daily limit — applies without having been told
 * about workflows at all.
 *
 * One deliberate behaviour change comes with it. The old one paused after every
 * step and waited to be clicked, so a workflow could not finish unattended;
 * this runs to the end. Stopping is still yours, and a failed step still stops
 * everything after it.
 */

/** Steps in flight, so the same workflow cannot be started twice over itself. */
const running = new Set<string>()

export function isWorkflowRunning(slug: string): boolean {
  return running.has(slug)
}

/**
 * What the next step is given.
 *
 * The previous step's output, and the original ask alongside it — without that
 * a five-step workflow has forgotten what it was for by step three, because
 * each agent only ever sees the one before it.
 */
export function stepInput(originalPrompt: string, previousOutput: string | null, label: string): string {
  if (previousOutput === null) return originalPrompt

  return `Original request:
${originalPrompt}

Output of the previous step:
${previousOutput}

Your step: ${label}`
}

/**
 * Start a workflow and return its record. The work is detached — it outlives
 * the request, exactly as a session turn does.
 */
export async function startWorkflowRun(
  workflow: Workflow,
  input: string,
  projectDir?: string,
): Promise<WorkflowRun> {
  if (!workflow.steps.length) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_steps', message: 'This workflow has no steps yet.' },
    })
  }

  if (running.has(workflow.slug)) {
    throw createError({
      statusCode: 409,
      data: { error: 'already_running', message: 'This workflow is already running.' },
    })
  }

  // Refused before anything is spent, so hitting the daily limit costs nothing.
  const budget = await checkBudget()
  if (!budget.allowed) {
    throw createError({ statusCode: 429, data: { error: 'over_budget', message: budget.reason! } })
  }

  const record: WorkflowRun = {
    id: newWorkflowRunId(),
    workflowSlug: workflow.slug,
    title: workflow.name,
    input,
    projectDir,
    status: 'running',
    steps: [],
    currentStep: 0,
    startedAt: Date.now(),
  }

  await saveWorkflowRun(record)
  running.add(workflow.slug)

  void execute(workflow, record).finally(() => running.delete(workflow.slug))

  return record
}

async function execute(workflow: Workflow, record: WorkflowRun): Promise<void> {
  const steps: WorkflowStepRun[] = []
  let previous: string | null = null
  /** Where a banner about this workflow takes you: the workflow's own page. */
  const workflowLink = `/workflows/${record.workflowSlug}`

  /**
   * Every step runs on the agent this repository was set to.
   *
   * Read once rather than per step: a workflow is one piece of work, and a
   * setting changed while it is running should not hand step four to a
   * different agent than step three.
   */
  const provider = await providerForProject(record.projectDir)

  try {
    for (const [index, step] of workflow.steps.entries()) {
      // Between steps as well as before the first: a workflow is the easiest
      // way there is to spend a day's allowance without noticing, and the
      // limit is worth nothing if it is only consulted once.
      //
      // Unattended from here on. Pressing Run is a decision about the first
      // step; by the fourth, nobody is watching and the rate limit is worth
      // leaving room in. The check before the run starts stays attended, so
      // starting one is never refused over a limit that is only nearly reached.
      const budget = await checkBudget(Date.now(), { unattended: index > 0 })
      if (!budget.allowed) {
        await finish(record.id, 'failed', budget.reason)
        await notify('needsYou', `${record.title} stopped`, budget.reason!, workflowLink)
        return
      }

      const options = await resolveRunOptionsFor({
        // A workflow runs to its end unattended; that is the whole point of it.
        unattended: true,
        projectDir: record.projectDir,
        agentSlug: step.agentSlug,
      })

      const run = createRun({
        kind: 'agent',
        title: `${workflow.name} — ${step.label}`,
        input: stepInput(record.input, previous, step.label),
        agentSlug: step.agentSlug,
        projectDir: options.cwd,
        provider,
      })

      steps.push({ stepId: step.id, agentSlug: step.agentSlug, runId: run.id })
      await patchWorkflowRun(record.id, { steps: [...steps], currentStep: index })

      await withRunSlot(() => executeRun(run, options, { maxBudgetUsd: budget.maxBudgetUsd }))

      const finished = getActive(run.id)?.run ?? await readRun(run.id)

      if (finished?.status === 'cancelled') {
        await finish(record.id, 'stopped')
        return
      }

      if (finished?.status !== 'completed') {
        const why = finished?.error || 'The step ended without finishing.'
        await finish(record.id, 'failed', `${step.label}: ${why}`)
        await notify('failed', `${record.title} failed`, `${step.label}: ${why}`, workflowLink)
        return
      }

      // What the next step reads. An empty answer is still an answer, but it
      // is worth saying so rather than handing on a blank.
      previous = finished.output.trim() || '(the step produced no output)'
    }

    await finish(record.id, 'completed')
    await notify('finished', record.title, previous ?? 'Finished.', workflowLink)
  } catch (e: any) {
    await finish(record.id, 'failed', e?.message || 'The workflow stopped unexpectedly.')
  }
}

async function finish(id: string, status: WorkflowRun['status'], error?: string): Promise<void> {
  await patchWorkflowRun(id, { status, error, endedAt: Date.now() })
}
