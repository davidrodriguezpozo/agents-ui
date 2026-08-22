import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The value figures, over a real run log rather than a fixture.
 *
 * `ritualValue.ts` has the judgement and its own tests; what this covers is the
 * wiring, which is where the interesting mistakes are. A ritual's spend and its
 * landings come from `joinOutcomes` and its runs come from the run log, and
 * those two have to agree about which ritual they belong to — a landing
 * credited to the wrong row would be a plausible-looking figure that is simply
 * false. It also pins the count that is easy to get wrong: a chained ritual is
 * one firing, not one per step.
 *
 * Nitro's helpers are auto-imported rather than imported, so they are stubbed —
 * the same arrangement `test/ledgerEndpoint.test.ts` describes.
 */

interface FakeEvent { query: Record<string, string> }

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getQuery = (event: FakeEvent) => event.query ?? {}
globals.createError = (init: { message?: string }) => new Error(init.message ?? 'error')

const DAY = 86_400_000
const NOW = Date.now()

let dir: string

async function writeRun(id: string, run: Record<string, unknown>) {
  await mkdir(join(dir, 'agents-ui', 'runs'), { recursive: true })
  await writeFile(
    join(dir, 'agents-ui', 'runs', `${id}.json`),
    JSON.stringify({
      id, kind: 'command', title: id, input: '', status: 'completed', output: '', events: [], ...run,
    }),
    'utf-8',
  )
}

/** One ritual firing, `days` ago, costing `costUsd`. */
async function ritualRun(id: string, scheduleId: string, days: number, run: Record<string, unknown> = {}) {
  await writeRun(id, {
    createdAt: NOW - days * DAY,
    startedAt: NOW - days * DAY,
    scheduleId,
    stats: { costUsd: 1 },
    ...run,
  })
}

let value: (event: FakeEvent) => Promise<any>

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-ritual-value-'))
  process.env.CLAUDE_DIR = dir

  // A briefing that works and merges nothing.
  for (const [index, id] of ['b1', 'b2', 'b3', 'b4'].entries()) {
    await ritualRun(id, 'brief', index + 1, { stats: { costUsd: 1.5 } })
  }

  // A ritual whose session went in. Its last turn is the last hand on that
  // session, which is what makes the landing this ritual's.
  for (const [index, id] of ['f1', 'f2', 'f3'].entries()) {
    await ritualRun(id, 'fixer', 4 - index, { sessionId: 'shipped', stats: { costUsd: 2 } })
  }

  // Meant to land code, and has not for a month.
  for (const [index, id] of ['s1', 's2', 's3'].entries()) {
    await ritualRun(id, 'stale', index + 1, { stats: { costUsd: 4 } })
  }

  // One firing of three steps, which must count as one run.
  for (const [index, id] of ['c1', 'c2', 'c3'].entries()) {
    await ritualRun(id, 'nightly', 2, { chainId: 'ch1', stepIndex: index, stats: { costUsd: 0.5 } })
  }

  await mkdir(join(dir, 'agents-ui'), { recursive: true })
  await writeFile(
    join(dir, 'agents-ui', 'sessions.json'),
    JSON.stringify({
      version: 1,
      sessions: [{
        id: 'shipped', title: 'Shipped', repoDir: '/repo/one', worktreePath: '/wt/shipped',
        branch: 'a', baseBranch: 'main', baseSha: 'x', status: 'idle', runIds: ['f1', 'f2', 'f3'],
        createdAt: NOW - 4 * DAY, updatedAt: NOW - 2 * DAY,
        landed: { at: NOW - 2 * DAY, how: 'merged', into: 'main', commits: 1 },
      }],
    }),
    'utf-8',
  )

  await writeFile(
    join(dir, 'agents-ui', 'schedules.json'),
    JSON.stringify({
      version: 1,
      schedules: [
        { id: 'brief', title: 'Morning brief', input: '/brief', recurrence: { hour: 8, minute: 0, days: [] }, permission: 'readonly', enabled: true, origin: 'user', createdAt: NOW - 40 * DAY },
        { id: 'fixer', title: 'Fix what CI found', input: '/fix', recurrence: { hour: 9, minute: 0, days: [] }, permission: 'edits', enabled: true, origin: 'user', createdAt: NOW - 40 * DAY },
        { id: 'stale', title: 'Clear the backlog', input: '/backlog', expects: 'code', recurrence: { hour: 7, minute: 0, days: [] }, permission: 'edits', enabled: true, origin: 'user', createdAt: NOW - 40 * DAY },
        { id: 'nightly', title: 'Nightly chain', input: '/triage', recurrence: { hour: 2, minute: 0, days: [] }, permission: 'edits', enabled: true, origin: 'user', createdAt: NOW - 40 * DAY },
      ],
    }),
    'utf-8',
  )

  value = (await import('../server/api/schedules/value.get')).default as unknown as typeof value
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

describe('the ritual value endpoint', () => {
  it('answers for every ritual that exists, and only those', async () => {
    const report = await value({ query: {} })

    expect(Object.keys(report.rituals).sort()).toEqual(['brief', 'fixer', 'nightly', 'stale'])
    expect(report.window.days).toBe(30)
  })

  it('does not call a briefing worthless', async () => {
    const { rituals } = await value({ query: {} })

    expect(rituals.brief.expects).toBe('report')
    expect(rituals.brief.costUsd).toBeCloseTo(6)
    expect(rituals.brief.runs).toBe(4)
    expect(rituals.brief.verdict).toContain('reports rather than lands')
    expect(rituals.brief.tone).toBe('plain')
  })

  it('credits a landing to the ritual whose turns produced it', async () => {
    const { rituals } = await value({ query: {} })

    expect(rituals.fixer.landings).toBe(1)
    // All three of its turns were spent on the session that merged.
    expect(rituals.fixer.costPerLandingUsd).toBeCloseTo(6)
    expect(rituals.fixer.expects).toBe('code')
    expect(rituals.fixer.assumed).toBe(true)
    // And nobody else gets the credit.
    expect(rituals.brief.landings).toBe(0)
    expect(rituals.stale.landings).toBe(0)
  })

  it('says the money and the nothing for a ritual that is meant to land code', async () => {
    const { rituals } = await value({ query: {} })

    expect(rituals.stale.assumed).toBe(false)
    expect(rituals.stale.tone).toBe('warn')
    expect(rituals.stale.verdict).toContain('$12.00')
    expect(rituals.stale.verdict).toContain('nothing landed')
  })

  it('counts a chain as one run and charges it for every step', async () => {
    const { rituals } = await value({ query: {} })

    expect(rituals.nightly.runs).toBe(1)
    expect(rituals.nightly.costUsd).toBeCloseTo(1.5)
    // One firing is not evidence, whatever it cost.
    expect(rituals.nightly.verdict).toContain('Too few')
  })

  it('narrows to the window it was asked for', async () => {
    const { rituals, window } = await value({ query: { days: '2' } })

    expect(window.days).toBe(2)
    // Only the firing from yesterday is left of the briefing's four.
    expect(rituals.brief.runs).toBe(1)
    expect(rituals.brief.costUsd).toBeCloseTo(1.5)
  })
})
