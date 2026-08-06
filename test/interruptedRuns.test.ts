import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * A run lives in memory — the query, the abort controller, the listeners — and
 * a restart loses all of it while the record on disk still says `running`. Left
 * alone, that run claims to be working forever, keeps its session busy, and
 * counts toward the badge that says something needs you.
 */

let dir: string
let store: typeof import('../server/utils/runStore')

const runsDir = () => join(dir, 'agents-ui', 'runs')

async function writeRun(id: string, status: string, extra: Record<string, unknown> = {}) {
  await mkdir(runsDir(), { recursive: true })
  await writeFile(
    join(runsDir(), `${id}.json`),
    JSON.stringify({ id, kind: 'chat', title: id, input: '', status, createdAt: 1, output: '', events: [], ...extra }),
    'utf-8',
  )
}

async function readRunFile(id: string) {
  return JSON.parse(await readFile(join(runsDir(), `${id}.json`), 'utf-8'))
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-interrupted-'))
  process.env.CLAUDE_DIR = dir
  store = await import('../server/utils/runStore')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
})

describe('after a restart', () => {
  it('closes a run that was still going', async () => {
    await writeRun('a', 'running')

    await expect(store.closeInterruptedRuns()).resolves.toHaveLength(1)

    const run = await readRunFile('a')
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/Interrupted/)
    expect(run.completedAt).toBeGreaterThan(0)
  })

  it('closes one that never started, too', async () => {
    await writeRun('a', 'queued')

    await expect(store.closeInterruptedRuns()).resolves.toHaveLength(1)
    expect((await readRunFile('a')).status).toBe('failed')
  })

  it('leaves finished runs exactly as they were', async () => {
    await writeRun('done', 'completed', { output: 'the answer' })
    await writeRun('bad', 'failed', { error: 'the original reason' })
    await writeRun('stopped', 'cancelled')

    await expect(store.closeInterruptedRuns()).resolves.toHaveLength(0)

    expect((await readRunFile('done')).output).toBe('the answer')
    // Overwriting this would replace why it failed with why the server did.
    expect((await readRunFile('bad')).error).toBe('the original reason')
    expect((await readRunFile('stopped')).status).toBe('cancelled')
  })

  it('steps over a damaged file rather than stopping', async () => {
    await mkdir(runsDir(), { recursive: true })
    await writeFile(join(runsDir(), 'broken.json'), 'not json', 'utf-8')
    await writeRun('a', 'running')

    await expect(store.closeInterruptedRuns()).resolves.toHaveLength(1)
  })

  it('has nothing to do on a machine that has never run anything', async () => {
    await expect(store.closeInterruptedRuns()).resolves.toHaveLength(0)
  })
})
