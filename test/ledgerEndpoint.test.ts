import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { localDay } from '../server/utils/spend'

/**
 * The ledger against the spend chart, over the same window.
 *
 * Brief 12's acceptance is "the headline agrees with the History tab for the same
 * window — if it does not, the join is wrong, not the page". That check cannot be
 * done by hand in an unattended session, so it is done here: both endpoints are
 * pointed at one seeded run log and their totals are required to reconcile.
 *
 * They reconcile rather than match, and the difference is the point. `/api/spend`
 * folds session summaries into its total; the ledger keeps them beside it, so
 * "what did the work cost" and "what did the app cost around the work" stay
 * separable. Anything else diverging means the join is reading the log
 * differently from the chart, which is exactly the failure worth catching.
 *
 * Nitro's helpers are auto-imported rather than imported, so they are stubbed —
 * the same arrangement `test/notificationStream.test.ts` describes.
 */

interface FakeEvent { query: Record<string, string> }

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getQuery = (event: FakeEvent) => event.query ?? {}
globals.createError = (init: { message?: string }) => new Error(init.message ?? 'error')

const DAY = 86_400_000
const NOW = Date.now()

let dir: string

/** Runs live one JSON file each under `agents-ui/runs`. */
async function writeRun(id: string, run: Record<string, unknown>) {
  await mkdir(join(dir, 'agents-ui', 'runs'), { recursive: true })
  await writeFile(
    join(dir, 'agents-ui', 'runs', `${id}.json`),
    JSON.stringify({
      id, kind: 'chat', title: id, input: '', status: 'completed', output: '', events: [], ...run,
    }),
    'utf-8',
  )
}

async function writeSessions(sessions: unknown[]) {
  await mkdir(join(dir, 'agents-ui'), { recursive: true })
  await writeFile(
    join(dir, 'agents-ui', 'sessions.json'),
    JSON.stringify({ version: 1, sessions }),
    'utf-8',
  )
}

let ledger: (event: FakeEvent) => Promise<any>
let spend: (event: FakeEvent) => Promise<any>

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-api-'))
  process.env.CLAUDE_DIR = dir

  // A merge two days ago, three turns behind it, one ritual that produced
  // nothing, and a session summary — the smallest log with something in every
  // bucket. `startedAt` matches `createdAt` throughout: the two endpoints place
  // a turn differently when a run queued across the window's edge, and that
  // difference is its own fact rather than this test's subject.
  await writeRun('a1', {
    createdAt: NOW - 2 * DAY, startedAt: NOW - 2 * DAY, sessionId: 'landed',
    projectDir: '/repo/one', stats: { costUsd: 2, model: 'claude-opus-5' },
    events: [{ seq: 0, at: NOW - 2 * DAY, type: 'tool_use', id: 'x', toolName: 'Edit' }],
  })
  await writeRun('a2', {
    createdAt: NOW - 2 * DAY + 1000, startedAt: NOW - 2 * DAY + 1000, sessionId: 'landed',
    projectDir: '/repo/one', stats: { costUsd: 1, model: 'claude-opus-5' },
  })
  await writeRun('b1', {
    createdAt: NOW - 3 * DAY, startedAt: NOW - 3 * DAY, sessionId: 'open',
    projectDir: '/repo/one', stats: { costUsd: 0.5, model: 'claude-sonnet-5' },
  })
  await writeRun('r1', {
    createdAt: NOW - DAY, startedAt: NOW - DAY, scheduleId: 'morning',
    projectDir: '/repo/two', stats: { costUsd: 0.25, model: 'claude-sonnet-5' },
  })
  // Last window, so it must not appear in this one's figures.
  await writeRun('old', {
    createdAt: NOW - 9 * DAY, startedAt: NOW - 9 * DAY, sessionId: 'before',
    projectDir: '/repo/one', stats: { costUsd: 8, model: 'claude-opus-5' },
  })

  await writeSessions([
    {
      id: 'landed', title: 'Landed', repoDir: '/repo/one', worktreePath: '/wt/landed',
      branch: 'a', baseBranch: 'main', baseSha: 'x', status: 'idle', runIds: ['a1', 'a2'],
      createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY,
      landed: { at: NOW - 2 * DAY, how: 'merged', into: 'main', commits: 2 },
      summary: { text: 'It landed.', fingerprint: 'f', costUsd: 0.01, at: NOW - 2 * DAY },
    },
    {
      id: 'open', title: 'Open', repoDir: '/repo/one', worktreePath: '/wt/open',
      branch: 'b', baseBranch: 'main', baseSha: 'x', status: 'idle', runIds: ['b1'],
      createdAt: NOW - 3 * DAY, updatedAt: NOW - 3 * DAY,
    },
    {
      id: 'before', title: 'Before', repoDir: '/repo/one', worktreePath: '/wt/before',
      branch: 'c', baseBranch: 'main', baseSha: 'x', status: 'idle', runIds: ['old'],
      createdAt: NOW - 9 * DAY, updatedAt: NOW - 9 * DAY,
      landed: { at: NOW - 9 * DAY, how: 'pull-request', pr: 3 },
    },
  ])

  ledger = (await import('../server/api/ledger.get')).default as unknown as typeof ledger
  spend = (await import('../server/api/spend.get')).default as unknown as typeof spend
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

describe('the ledger endpoint', () => {
  it('adds up to what the spend chart says over the same window', async () => {
    const [priced, charted] = await Promise.all([
      ledger({ query: { days: '7' } }),
      spend({ query: { days: '7' } }),
    ])

    // The chart folds summaries in; the ledger reports them beside the totals.
    expect(priced.current.costUsd + priced.current.side.costUsd).toBeCloseTo(charted.total)
    expect(priced.current.side).toEqual({ costUsd: 0.01, calls: 1 })
    // And they start on the same day, or the agreement above was luck.
    expect(priced.window.since).toBe(new Date(NOW - 6 * DAY).setHours(0, 0, 0, 0))
    expect(charted.byDay).toHaveLength(7)
    expect(charted.byDay[0].date).toBe(localDay(priced.window.since))
  })

  it('answers what a merge cost, and what produced nothing', async () => {
    const priced = await ledger({ query: { days: '7' } })

    expect(priced.current.landings).toMatchObject({ total: 1, merged: 1 })
    // Both turns of the session that merged, and only those.
    expect(priced.current.costPerLandingUsd).toBeCloseTo(3)
    expect(priced.current.openCostUsd).toBeCloseTo(0.5)
    // The ritual: real output, and not a merge.
    expect(priced.current.unattributedCostUsd).toBeCloseTo(0.25)
  })

  it('holds last week apart from this one', async () => {
    const priced = await ledger({ query: { days: '7' } })

    expect(priced.previous.costPerLandingUsd).toBeCloseTo(8)
    expect(priced.perLandingChange).toBeCloseTo((3 - 8) / 8)
  })

  it('groups by the model and repository a summary would have dropped', async () => {
    const priced = await ledger({ query: { days: '7' } })

    const models = priced.tables.find((t: { dimension: string }) => t.dimension === 'model')
    expect(models.rows.map((r: { key: string }) => r.key)).toEqual(['claude-opus-5', 'claude-sonnet-5'])

    const repos = priced.tables.find((t: { dimension: string }) => t.dimension === 'repository')
    expect(repos.rows.map((r: { key: string }) => r.key)).toEqual(['/repo/one', '/repo/two'])
  })

  it('names a ritual whose title it cannot find by its id', async () => {
    // No schedules were written, so there is no title to use — and a row reading
    // nothing at all would be worse than one reading the id.
    const priced = await ledger({ query: { days: '7' } })
    const rituals = priced.tables.find((t: { dimension: string }) => t.dimension === 'ritual')

    expect(rituals.rows[0].key).toBe('morning')
    expect(rituals.rows[0].label).toBeUndefined()
  })
})
