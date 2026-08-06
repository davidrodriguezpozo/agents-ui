import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'

/**
 * A workflow run: the thing a workflow produces, kept.
 *
 * Workflows were the one thing here that ran entirely in the browser. Each
 * step called the chat endpoint directly, and the result lived in a `ref` — so
 * closing the tab lost the run, Activity never heard about it, the spend page
 * under-reported by every workflow anyone had ever run, and a daily limit that
 * would stop a session did not apply.
 *
 * One cause, four symptoms, and the fix is the same one sessions already use:
 * every step is a real run in the run store, and this record owns the ordered
 * list of them. A workflow run is then exactly what a session is — a durable
 * thing with runs hanging off it — which means everything already built for
 * runs works for workflows without being told about them.
 */

export type WorkflowRunStatus =
  /** Working through the steps. */
  | 'running'
  /** Every step finished. */
  | 'completed'
  /** A step failed, so the ones after it never ran. See `error`. */
  | 'failed'
  /** Somebody stopped it. Whatever had finished is still here. */
  | 'stopped'

export interface WorkflowStepRun {
  /** The step in the workflow this was, by id, so a reordered workflow still reads. */
  stepId: string
  agentSlug?: string
  /** The run in the run store, which owns the output, the cost and the events. */
  runId: string
}

export interface WorkflowRun {
  id: string
  workflowSlug: string
  /** The workflow's name when it ran, since a workflow can be renamed after. */
  title: string
  /** What was typed to start it, which is the first step's input. */
  input: string
  projectDir?: string
  status: WorkflowRunStatus
  steps: WorkflowStepRun[]
  /** Which step is in flight, or the one that failed. */
  currentStep: number
  error?: string
  startedAt: number
  endedAt?: number
}

export function newWorkflowRunId(): string {
  return `wfr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Kept apart from the workflow definitions, which are files a person edits.
 * History is ours and is written constantly; mixing the two would mean a run
 * finishing could lose an edit made while it ran.
 */
export const workflowRunStore = defineJsonStore<WorkflowRun[]>({
  label: 'workflow runs',
  path: () => join(getClaudeDir(), 'agents-ui', 'workflow-runs.json'),
  empty: () => [],
  decode: parsed => parsed?.runs ?? [],
  encode: runs => ({ version: 1, runs }),
})

/** Newest first, and bounded — this is history, not an archive. */
const KEEP = 200

export async function readWorkflowRuns(): Promise<WorkflowRun[]> {
  try {
    return await workflowRunStore.read()
  } catch {
    return []
  }
}

export async function findWorkflowRun(id: string): Promise<WorkflowRun | null> {
  return (await readWorkflowRuns()).find(r => r.id === id) ?? null
}

export async function saveWorkflowRun(run: WorkflowRun): Promise<WorkflowRun> {
  return workflowRunStore.update((runs) => {
    const index = runs.findIndex(r => r.id === run.id)
    if (index >= 0) runs[index] = run
    else runs.unshift(run)

    // Oldest first out. Losing the tail of history is a fair price for a file
    // that stays a sensible size on a machine that runs workflows all day.
    if (runs.length > KEEP) runs.length = KEEP
    return run
  })
}

export async function patchWorkflowRun(
  id: string,
  patch: Partial<WorkflowRun>,
): Promise<WorkflowRun | null> {
  return workflowRunStore.update((runs) => {
    const run = runs.find(r => r.id === id)
    if (!run) return null
    Object.assign(run, patch)
    return run
  })
}

/** The runs belonging to one workflow, newest first. */
export async function runsForWorkflow(slug: string): Promise<WorkflowRun[]> {
  return (await readWorkflowRuns()).filter(r => r.workflowSlug === slug)
}

/**
 * A workflow run left `running` by a restart did not survive it — the steps
 * were children of a process that is gone. Called at startup, alongside the
 * same tidy-up for runs and sessions.
 */
export async function closeInterruptedWorkflowRuns(): Promise<number> {
  let closed = 0
  await workflowRunStore.update((runs) => {
    for (const run of runs) {
      if (run.status !== 'running') continue
      run.status = 'failed'
      run.error = 'Interrupted by a restart.'
      run.endedAt = Date.now()
      closed++
    }
  })
  return closed
}
