import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import type { LandingNeed, LandingOutcome } from './landing'

/**
 * A landing run: an attempt to put several finished sessions into the base
 * branch, kept.
 *
 * Durable for the same reason a workflow run is. Each session may need its
 * checks run again, and a check is a test suite — six of them is half an hour
 * during which nobody is going to sit and watch. Closing the tab must not lose
 * the record of what merged and what did not, because that record is the only
 * account of a set of merges that happened while you were elsewhere.
 */

export type LandingRunStatus =
  /** Working through the queue. */
  | 'running'
  /** Reached the end. Individual sessions may still have been left alone. */
  | 'completed'
  /** Stopped early — git would not let anything merge here. See `error`. */
  | 'stopped'

export interface LandingStep {
  sessionId: string
  title: string
  /** What the plan said it needed when the run started. */
  need: LandingNeed
  /** Absent while this step is in flight. */
  outcome?: LandingOutcome
  detail?: string
  startedAt: number
  endedAt?: number
}

export interface LandingRun {
  id: string
  repoDir: string
  baseBranch: string
  status: LandingRunStatus
  steps: LandingStep[]
  /** Named here as well as in the steps, so the record explains its own gaps. */
  skipped: { sessionId: string; title: string; reason: string }[]
  error?: string
  summary?: string
  startedAt: number
  endedAt?: number
}

export function newLandingRunId(): string {
  return `land-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const landingRunStore = defineJsonStore<LandingRun[]>({
  label: 'landing runs',
  path: () => join(getClaudeDir(), 'agents-ui', 'landing-runs.json'),
  empty: () => [],
  decode: parsed => parsed?.runs ?? [],
  encode: runs => ({ version: 1, runs }),
})

/** History, not an archive. */
const KEEP = 100

export async function readLandingRuns(): Promise<LandingRun[]> {
  try {
    return await landingRunStore.read()
  } catch {
    return []
  }
}

export async function findLandingRun(id: string): Promise<LandingRun | null> {
  return (await readLandingRuns()).find(r => r.id === id) ?? null
}

export async function saveLandingRun(run: LandingRun): Promise<LandingRun> {
  return landingRunStore.update((runs) => {
    const index = runs.findIndex(r => r.id === run.id)
    if (index >= 0) runs[index] = run
    else runs.unshift(run)
    if (runs.length > KEEP) runs.length = KEEP
    return run
  })
}

export async function patchLandingRun(
  id: string,
  patch: Partial<LandingRun>,
): Promise<LandingRun | null> {
  return landingRunStore.update((runs) => {
    const run = runs.find(r => r.id === id)
    if (!run) return null
    Object.assign(run, patch)
    return run
  })
}

/**
 * A landing run left `running` by a restart did not survive it.
 *
 * Merges that already happened are in git and are not in doubt; what is lost
 * is whatever was mid-flight. Marked stopped rather than failed, because
 * nothing here went wrong — the process went away.
 */
export async function closeInterruptedLandingRuns(): Promise<number> {
  let closed = 0

  await landingRunStore.update((runs) => {
    for (const run of runs) {
      if (run.status !== 'running') continue
      run.status = 'stopped'
      run.error = 'The server stopped part-way. Anything already merged is merged; the rest was not attempted.'
      run.endedAt = Date.now()
      for (const step of run.steps) {
        if (!step.outcome) {
          step.outcome = 'refused'
          step.detail = 'Interrupted by a restart.'
          step.endedAt = Date.now()
        }
      }
      closed++
    }
  })

  return closed
}
