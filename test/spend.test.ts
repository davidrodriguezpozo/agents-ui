import { describe, expect, it } from 'vitest'
import { localDay, summarizeSpend } from '../server/utils/spend'
import type { RunSummary } from '../server/utils/runStore'

/**
 * Money. The failure that matters is under-reporting — a total that looks
 * comfortable because something was quietly left out of it.
 */

const DAY = 86_400_000
const NOW = new Date(2026, 7, 4, 15, 0, 0).getTime()

let seq = 0
function run(patch: Partial<RunSummary> = {}): RunSummary {
  return {
    id: `r${seq++}`,
    kind: 'command',
    title: 'A run',
    status: 'completed',
    createdAt: NOW,
    preview: '',
    source: 'ritual',
    costUsd: 0.10,
    ...patch,
  }
}

describe('adding it up', () => {
  it('totals what the runs cost', () => {
    const summary = summarizeSpend([run({ costUsd: 0.10 }), run({ costUsd: 0.25 })], 7, NOW)

    expect(summary.total).toBeCloseTo(0.35)
    expect(summary.runs).toBe(2)
  })

  it('ignores runs with no cost recorded, without counting them as free runs', () => {
    // A cancelled run has no cost; counting it would drag every average down.
    const summary = summarizeSpend([run({ costUsd: 0.20 }), run({ costUsd: undefined }), run({ costUsd: 0 })], 7, NOW)

    expect(summary.total).toBeCloseTo(0.20)
    expect(summary.runs).toBe(1)
  })

  it('splits by what set the run going', () => {
    const summary = summarizeSpend([
      run({ source: 'ritual', costUsd: 0.30 }),
      run({ source: 'session', costUsd: 0.10 }),
      run({ source: 'ritual', costUsd: 0.20 }),
    ], 7, NOW)

    expect(summary.bySource[0]).toMatchObject({ source: 'ritual', cost: 0.5, runs: 2 })
    expect(summary.bySource[1]).toMatchObject({ source: 'session', runs: 1 })
  })

  it('names the most expensive runs, largest first', () => {
    const summary = summarizeSpend([
      run({ title: 'cheap', costUsd: 0.01 }),
      run({ title: 'dear', costUsd: 2.00 }),
      run({ title: 'middling', costUsd: 0.50 }),
    ], 7, NOW)

    expect(summary.top.map(t => t.title)).toEqual(['dear', 'middling', 'cheap'])
  })
})

describe('by day', () => {
  it('includes days on which nothing ran', () => {
    // A quiet day should read as a gap, not vanish and make the week look busy.
    const summary = summarizeSpend([run({ createdAt: NOW })], 7, NOW)

    expect(summary.byDay).toHaveLength(7)
    expect(summary.byDay.filter(d => d.cost === 0)).toHaveLength(6)
  })

  it('ends on today', () => {
    const summary = summarizeSpend([], 3, NOW)

    expect(summary.byDay.at(-1)!.date).toBe(localDay(NOW))
  })

  it('puts a run on the day it happened', () => {
    const summary = summarizeSpend([run({ createdAt: NOW - 2 * DAY, costUsd: 0.4 })], 7, NOW)
    const day = summary.byDay.find(d => d.date === localDay(NOW - 2 * DAY))!

    expect(day.cost).toBeCloseTo(0.4)
    expect(day.runs).toBe(1)
  })

  it('leaves a run older than the window out of the days but not the maths', () => {
    // It is still spend; it simply has no column. Silently adding it to the
    // first visible day would be a lie about when it happened.
    const summary = summarizeSpend([run({ createdAt: NOW - 30 * DAY, costUsd: 5 })], 7, NOW)

    expect(summary.byDay.every(d => d.cost === 0)).toBe(true)
    expect(summary.total).toBeCloseTo(5)
  })

  it('uses the day you were standing in, not the one UTC was', () => {
    // Late evening local time is already tomorrow in UTC; bucketing by UTC
    // would file yesterday evening's work under today.
    const lateEvening = new Date(2026, 7, 4, 23, 30).getTime()

    expect(localDay(lateEvening)).toBe('2026-08-04')
  })
})

describe('projecting forward', () => {
  it('scales the window to a month', () => {
    const summary = summarizeSpend([run({ costUsd: 7 })], 7, NOW)

    expect(summary.monthlyEstimate).toBeCloseTo(30)
  })

  it('has nothing to project from nothing', () => {
    expect(summarizeSpend([], 7, NOW).monthlyEstimate).toBe(0)
  })
})
