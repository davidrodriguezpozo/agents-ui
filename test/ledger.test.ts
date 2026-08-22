import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  buildLedger, ledgerWindow, unmergedCostUsd, MAX_LEDGER_DAYS,
} from '../server/utils/ledger'
import type { OutcomeRunRecord, OutcomeSession, OutcomeTotals } from '../server/utils/outcomes'

/**
 * Cost per accepted merge, for a window and the one before it.
 *
 * The failures worth guarding are all the flattering ones: a window compared
 * against a shorter window, a merge counted in both halves, "no merges" reported
 * as a free merge, and spend on a session started this morning written off as
 * waste.
 */

const DAY = 86_400_000
const NOW = new Date(2026, 7, 20, 9, 0, 0).getTime()

let seq = 0

function record(patch: Partial<OutcomeRunRecord> = {}): OutcomeRunRecord {
  return {
    id: `r${seq++}`,
    title: 'A turn',
    kind: 'chat',
    status: 'completed',
    createdAt: NOW - DAY,
    stats: { costUsd: 1 },
    events: [],
    ...patch,
  }
}

function session(patch: Partial<OutcomeSession> = {}): OutcomeSession {
  return { id: `s${seq++}`, repoDir: '/repo/one', status: 'idle', ...patch }
}

describe('the window', () => {
  it('is whole local days, ending now', () => {
    const window = ledgerWindow(7, NOW)

    expect(window.since).toBe(new Date(2026, 7, 14).getTime())
    expect(window.until).toBe(NOW)
  })

  it('compares against the same number of days, not the same calendar week', () => {
    // A calendar week on a Tuesday would put two days against seven and report
    // a triumph.
    const window = ledgerWindow(7, NOW)

    expect(window.previousSince).toBe(new Date(2026, 7, 7).getTime())
    expect(window.previousUntil).toBe(window.since - 1)
    // Seven whole days, to the millisecond.
    expect(window.since - window.previousSince).toBe(7 * DAY)
  })

  it('runs the current window short by whatever is left of today', () => {
    // Deliberate, and the reason the headline is a ratio rather than a total:
    // cost per landing survives a window cut off partway, where "spent this
    // week against spent last week" would report a fall every morning.
    const window = ledgerWindow(7, NOW)
    expect(window.until - window.since).toBeLessThan(7 * DAY)
  })

  it('leaves no millisecond in both halves', () => {
    const window = ledgerWindow(30, NOW)
    expect(window.previousUntil).toBeLessThan(window.since)
  })

  it('clamps a day count nobody should be asking for', () => {
    expect(ledgerWindow(0, NOW).days).toBe(1)
    expect(ledgerWindow(-4, NOW).days).toBe(1)
    expect(ledgerWindow(5000, NOW).days).toBe(MAX_LEDGER_DAYS)
    expect(ledgerWindow(Number.NaN, NOW).days).toBe(1)
  })
})

describe('the headline', () => {
  const landedThis = session({
    id: 'this',
    landed: { at: NOW - DAY, how: 'merged', into: 'main' },
  })
  const landedLast = session({
    id: 'last',
    landed: { at: NOW - 9 * DAY, how: 'merged', into: 'main' },
  })

  const ledger = buildLedger({
    days: 7,
    now: NOW,
    sessions: [landedThis, landedLast],
    runs: [
      record({ sessionId: 'this', createdAt: NOW - DAY, stats: { costUsd: 3 } }),
      record({ sessionId: 'last', createdAt: NOW - 9 * DAY, stats: { costUsd: 8 } }),
    ],
  })

  it('is spend per landing for this window', () => {
    expect(ledger.current.landings.total).toBe(1)
    expect(ledger.current.costPerLandingUsd).toBeCloseTo(3)
  })

  it('is the same figure for the window before it', () => {
    expect(ledger.previous.landings.total).toBe(1)
    expect(ledger.previous.costPerLandingUsd).toBeCloseTo(8)
  })

  it('reports the change as a fraction of the earlier figure', () => {
    // 3 against 8 — a bit under two thirds cheaper.
    expect(ledger.perLandingChange).toBeCloseTo((3 - 8) / 8)
  })

  it('refuses a change when either window has no merge', () => {
    // No merges is not an infinitely expensive merge and it is not a free one.
    const quiet = buildLedger({
      days: 7,
      now: NOW,
      sessions: [landedThis],
      runs: [record({ sessionId: 'this', stats: { costUsd: 3 } })],
    })

    expect(quiet.current.costPerLandingUsd).toBeCloseTo(3)
    expect(quiet.previous.costPerLandingUsd).toBeNull()
    expect(quiet.perLandingChange).toBeNull()
  })
})

describe('what produced nothing', () => {
  it('counts a session set aside and spend no session owns', () => {
    const totals = {
      abandonedCostUsd: 2,
      unattributedCostUsd: 0.5,
      openCostUsd: 7,
      landedCostUsd: 1,
    } as OutcomeTotals

    expect(unmergedCostUsd(totals)).toBeCloseTo(2.5)
  })

  it('leaves open sessions out of it', () => {
    // Unresolved is not wasted. Counting it would make every busy Friday look
    // like a write-off.
    const open = session({ id: 'open' })
    const ledger = buildLedger({
      days: 7,
      now: NOW,
      sessions: [open],
      runs: [record({ sessionId: 'open', projectDir: '/repo/one', stats: { costUsd: 4 } })],
    })

    const repo = ledger.tables.find(t => t.dimension === 'repository')!.rows[0]!
    expect(repo.openCostUsd).toBeCloseTo(4)
    expect(repo.unmergedCostUsd).toBe(0)
  })

  it('calls a ritual that landed nothing exactly that', () => {
    // No session owns a ritual's turn, so none of its spend will ever be
    // credited with a merge — which is the number that gets a ritual deleted.
    const ledger = buildLedger({
      days: 7,
      now: NOW,
      sessions: [],
      runs: [record({ scheduleId: 'morning', stats: { costUsd: 0.5 } })],
    })

    const ritual = ledger.tables.find(t => t.dimension === 'ritual')!.rows[0]!
    expect(ritual).toMatchObject({ key: 'morning', landings: 0, costPerLandingUsd: null })
    expect(ritual.unmergedCostUsd).toBeCloseTo(0.5)
  })
})

describe('naming a row', () => {
  const input = {
    days: 7,
    now: NOW,
    sessions: [],
    runs: [record({ scheduleId: 'k3f9x-a1', stats: { costUsd: 0.5 } })],
  }

  it('calls a ritual by its title rather than its id', () => {
    const ledger = buildLedger({ ...input, ritualTitles: { 'k3f9x-a1': 'Morning briefing' } })
    expect(ledger.tables.find(t => t.dimension === 'ritual')!.rows[0]!.label).toBe('Morning briefing')
  })

  it('leaves the label off when there is no title to use', () => {
    // Absent rather than a copy of the key, so the page can tell the difference
    // between "named" and "we only have the id".
    const ledger = buildLedger(input)
    expect(ledger.tables.find(t => t.dimension === 'ritual')!.rows[0]!.label).toBeUndefined()
  })

  it('never labels the other three, whose keys are already names', () => {
    const named = buildLedger({
      days: 7,
      now: NOW,
      sessions: [session({ id: 'one', agentSlug: 'reviewer' })],
      runs: [record({ sessionId: 'one', agentSlug: 'reviewer', stats: { costUsd: 1, model: 'claude-opus-5' } })],
      ritualTitles: { reviewer: 'Not this', 'claude-opus-5': 'Nor this' },
    })

    for (const table of named.tables.filter(t => t.dimension !== 'ritual')) {
      for (const row of table.rows) expect(row.label).toBeUndefined()
    }
  })
})

describe('the four breakdowns', () => {
  const landed = session({
    id: 'one',
    repoDir: '/repo/one',
    agentSlug: 'reviewer',
    landed: { at: NOW - DAY, how: 'pull-request', pr: 4 },
  })

  const ledger = buildLedger({
    days: 7,
    now: NOW,
    sessions: [landed],
    runs: [
      record({
        sessionId: 'one',
        agentSlug: 'reviewer',
        stats: { costUsd: 2, model: 'claude-opus-5' },
        events: [{ seq: 0, at: NOW - DAY, type: 'tool_use', id: 'x', toolName: 'Write' }],
      }),
      record({ scheduleId: 'morning', projectDir: '/repo/two', stats: { costUsd: 0.5, model: 'claude-sonnet-5' } }),
    ],
  })

  it('is by ritual, agent, model and repository, in that order', () => {
    expect(ledger.tables.map(t => t.dimension)).toEqual(['ritual', 'agent', 'model', 'repository'])
  })

  it('groups by model, which only a run record carries', () => {
    // `RunSummary` has no model, which is why this reads records — see
    // `runRecordsSince`.
    expect(ledger.tables.find(t => t.dimension === 'model')!.rows.map(r => r.key))
      .toEqual(['claude-opus-5', 'claude-sonnet-5'])
  })

  it('groups by repository, from the session and from the run', () => {
    expect(ledger.tables.find(t => t.dimension === 'repository')!.rows.map(r => r.key))
      .toEqual(['/repo/one', '/repo/two'])
  })

  it('carries spend, landings and spend per landing per row', () => {
    const agent = ledger.tables.find(t => t.dimension === 'agent')!.rows[0]!
    expect(agent).toMatchObject({ key: 'reviewer', turns: 1, landings: 1 })
    expect(agent.costUsd).toBeCloseTo(2)
    expect(agent.costPerLandingUsd).toBeCloseTo(2)
  })

  it('measures whether a turn changed a file off the events it was handed', () => {
    expect(ledger.current.changedFiles).toEqual({ turns: 1, measured: 2, share: 0.5 })
  })
})

describe('two hundred landings', () => {
  // The page has to read correctly on a busy machine as well as a quiet one, and
  // the arithmetic has to hold at both ends.
  const sessions = Array.from({ length: 200 }, (_, i) => session({
    id: `s-${i}`,
    repoDir: `/repo/${i % 4}`,
    landed: { at: NOW - DAY, how: 'merged', into: 'main' },
  }))

  const ledger = buildLedger({
    days: 7,
    now: NOW,
    sessions,
    runs: sessions.map((s, i) => record({
      sessionId: s.id,
      stats: { costUsd: 0.5, model: i % 2 ? 'claude-opus-5' : 'claude-sonnet-5' },
    })),
  })

  it('adds up', () => {
    expect(ledger.current.landings.total).toBe(200)
    expect(ledger.current.costUsd).toBeCloseTo(100)
    expect(ledger.current.costPerLandingUsd).toBeCloseTo(0.5)
  })

  it('keeps the group landings at or under the total', () => {
    for (const table of ledger.tables) {
      const summed = table.rows.reduce((n, row) => n + row.landings, 0)
      expect(summed).toBeLessThanOrEqual(ledger.current.landings.total)
    }
  })

  it('does not grow a row per session', () => {
    expect(ledger.tables.find(t => t.dimension === 'repository')!.rows).toHaveLength(4)
    expect(ledger.tables.find(t => t.dimension === 'model')!.rows).toHaveLength(2)
  })
})

describe('runRecordsSince', () => {
  let dir: string
  let store: typeof import('../server/utils/runStore')

  const runsDir = () => join(dir, 'agents-ui', 'runs')

  async function write(id: string, run: Record<string, unknown>) {
    await mkdir(runsDir(), { recursive: true })
    await writeFile(
      join(runsDir(), `${id}.json`),
      JSON.stringify({ id, kind: 'chat', title: id, input: '', status: 'completed', output: '', events: [], ...run }),
      'utf-8',
    )
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-'))
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

  it('hands over the fields a summary drops', async () => {
    await write('a', {
      createdAt: NOW - DAY,
      projectDir: '/repo/one',
      stats: { costUsd: 0.4, model: 'claude-opus-5' },
      events: [{ seq: 0, at: NOW - DAY, type: 'tool_use', id: 'x', toolName: 'Edit' }],
    })

    const [run] = await store.runRecordsSince(NOW - 7 * DAY)

    expect(run?.projectDir).toBe('/repo/one')
    expect(run?.stats?.model).toBe('claude-opus-5')
    expect(run?.events).toHaveLength(1)
  })

  it('keeps a turn that was asked for before the window but began inside it', async () => {
    // Runs queue per repository, so this is when the money was spent.
    await write('queued', { createdAt: NOW - 9 * DAY, startedAt: NOW - DAY })
    await write('old', { createdAt: NOW - 9 * DAY, startedAt: NOW - 9 * DAY })

    const ids = (await store.runRecordsSince(NOW - 7 * DAY)).map(run => run.id)

    expect(ids).toEqual(['queued'])
  })
})
