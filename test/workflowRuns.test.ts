import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * The record a workflow leaves behind.
 *
 * Workflows used to run in the browser and leave nothing at all — close the
 * tab and the run was gone. These cover the part that makes that untrue: it is
 * written down, it survives a restart as something other than "running
 * forever", and the history stays a sensible size.
 */

let claudeDir: string
let store: typeof import('../server/utils/workflowRuns')
let runner: typeof import('../server/utils/workflowRunner')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-wfr-'))
  process.env.CLAUDE_DIR = claudeDir
  store = await import('../server/utils/workflowRuns')
  runner = await import('../server/utils/workflowRunner')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await store.workflowRunStore.update((runs) => { runs.length = 0 })
})

let n = 0
function record(patch: Partial<import('../server/utils/workflowRuns').WorkflowRun> = {}) {
  return {
    id: `wfr-${++n}`,
    workflowSlug: 'ship-it',
    title: 'Ship it',
    input: 'do the thing',
    status: 'running' as const,
    steps: [],
    currentStep: 0,
    startedAt: Date.now(),
    ...patch,
  }
}

describe('workflow run history', () => {
  it('keeps a run and finds it again', async () => {
    const saved = await store.saveWorkflowRun(record())
    expect((await store.findWorkflowRun(saved.id))?.title).toBe('Ship it')
  })

  it('updates in place rather than adding a second copy', async () => {
    const saved = await store.saveWorkflowRun(record())
    await store.patchWorkflowRun(saved.id, { status: 'completed' })

    const all = await store.readWorkflowRuns()
    expect(all).toHaveLength(1)
    expect(all[0]!.status).toBe('completed')
  })

  it('groups by workflow, so one workflow\'s history is its own', async () => {
    await store.saveWorkflowRun(record({ workflowSlug: 'ship-it' }))
    await store.saveWorkflowRun(record({ workflowSlug: 'triage' }))

    expect(await store.runsForWorkflow('ship-it')).toHaveLength(1)
    expect(await store.runsForWorkflow('nothing-called-this')).toHaveLength(0)
  })

  it('does not grow without limit', async () => {
    for (let i = 0; i < 210; i++) await store.saveWorkflowRun(record())
    expect((await store.readWorkflowRuns()).length).toBeLessThanOrEqual(200)
  })

  it('closes runs a restart interrupted, rather than leaving them running forever', async () => {
    await store.saveWorkflowRun(record({ status: 'running' }))
    await store.saveWorkflowRun(record({ status: 'completed' }))

    expect(await store.closeInterruptedWorkflowRuns()).toBe(1)

    const all = await store.readWorkflowRuns()
    expect(all.find(r => r.error)?.status).toBe('failed')
    // A finished run is not somebody else's business to reopen.
    expect(all.filter(r => r.status === 'completed')).toHaveLength(1)
  })
})

describe('stepInput', () => {
  it('gives the first step exactly what was asked', () => {
    expect(runner.stepInput('summarise the changes', null, 'Review')).toBe('summarise the changes')
  })

  it('carries the original ask forward, not just the last output', () => {
    // Each agent only sees the step before it, so without this a five-step
    // workflow has forgotten what it was for by step three.
    const input = runner.stepInput('summarise the changes', 'I found three bugs.', 'Write it up')

    expect(input).toContain('summarise the changes')
    expect(input).toContain('I found three bugs.')
    expect(input).toContain('Write it up')
  })
})
