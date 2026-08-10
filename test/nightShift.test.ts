import { describe, expect, it } from 'vitest'
import {
  LANE_ORDER,
  MIN_WIDTH,
  classify,
  endOf,
  formatDuration,
  formatStamp,
  formatWindowLabel,
  hourTicks,
  layoutNight,
  spendCurve,
  startOf,
  summarizeNight,
  type TimelineRun,
} from '../app/utils/nightShift'

/**
 * The chart is arithmetic plus a stylesheet, and only the arithmetic can be
 * tested — so everything that decides *where* a run is drawn lives here rather
 * than in the component. Lane packing is the part that goes subtly wrong: two
 * sessions running at once is the normal case in this app, not an edge case.
 */

const HOUR = 3_600_000
const NOON = new Date(2026, 7, 10, 12, 0, 0).getTime()

function run(over: Partial<TimelineRun> = {}): TimelineRun {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'a run',
    source: 'ritual',
    status: 'completed',
    createdAt: NOON,
    startedAt: NOON,
    completedAt: NOON + HOUR,
    ...over,
  }
}

describe('when a run started', () => {
  it('prefers the real start over when it was asked for', () => {
    // Runs queue per repository, so a ritual created at 08:00 can start at 08:06.
    // Drawn on createdAt it would sit in the wrong minute.
    expect(startOf(run({ createdAt: NOON, startedAt: NOON + 6 * 60_000 }))).toBe(NOON + 6 * 60_000)
  })

  it('falls back to creation when it never recorded a start', () => {
    expect(startOf(run({ createdAt: NOON, startedAt: undefined }))).toBe(NOON)
  })
})

describe('when a run ended', () => {
  it('uses the recorded end', () => {
    expect(endOf(run({ completedAt: NOON + HOUR }), NOON + 5 * HOUR)).toBe(NOON + HOUR)
  })

  it('reaches now while it is still going', () => {
    // "No end" cannot be drawn, and a run still working looks exactly like a
    // block whose right edge is the present moment.
    const now = NOON + 2 * HOUR
    expect(endOf(run({ status: 'running', completedAt: undefined }), now)).toBe(now)
  })

  it('does not reach now for a finished run missing its end', () => {
    // Otherwise a crashed run from 03:00 draws a bar across the whole night.
    const now = NOON + 9 * HOUR
    const orphan = run({ status: 'completed', completedAt: undefined, durationMs: undefined })
    expect(endOf(orphan, now)).toBe(NOON)
  })

  it('uses duration when there is one but no end timestamp', () => {
    const orphan = run({ status: 'completed', completedAt: undefined, durationMs: 90_000 })
    expect(endOf(orphan, NOON + 9 * HOUR)).toBe(NOON + 90_000)
  })
})

describe('classifying an outcome', () => {
  it('calls a clean finish succeeded', () => {
    expect(classify(run())).toBe('succeeded')
  })

  it('separates "needed you" from success', () => {
    // These report success having skipped the part that needed a permission.
    // Folding them into either neighbour is how a night that did half its work
    // looks like a night that worked.
    expect(classify(run({ needsAttention: true }))).toBe('attention')
    expect(classify(run({ deniedTools: ['Bash'] }))).toBe('attention')
    expect(classify(run({ refusedHosts: ['api.example.com'] }))).toBe('attention')
    expect(classify(run({ stoppedBy: 'budget' }))).toBe('attention')
  })

  it('prefers the hard failure when a run is both', () => {
    expect(classify(run({ status: 'failed', needsAttention: true }))).toBe('failed')
  })

  it('keeps a run you stopped apart from one that broke', () => {
    expect(classify(run({ status: 'cancelled' }))).toBe('cancelled')
  })

  it('treats queued as running, because it is not finished', () => {
    expect(classify(run({ status: 'queued' }))).toBe('running')
  })
})

describe('packing lanes', () => {
  const from = NOON
  const to = NOON + 12 * HOUR

  it('keeps sequential runs on one row', () => {
    const lanes = layoutNight([
      run({ startedAt: from, completedAt: from + HOUR }),
      run({ startedAt: from + 2 * HOUR, completedAt: from + 3 * HOUR }),
    ], from, to, to)

    const ritual = lanes.find(l => l.source === 'ritual')!
    expect(ritual.rows).toBe(1)
    expect(ritual.blocks.map(b => b.row)).toEqual([0, 0])
  })

  it('stacks runs that overlap', () => {
    // Two sessions at once is what worktrees are for. On one row the second
    // would be drawn over the first and lost.
    const lanes = layoutNight([
      run({ source: 'session', startedAt: from, completedAt: from + 4 * HOUR }),
      run({ source: 'session', startedAt: from + HOUR, completedAt: from + 2 * HOUR }),
      run({ source: 'session', startedAt: from + 90 * 60_000, completedAt: from + 3 * HOUR }),
    ], from, to, to)

    const session = lanes.find(l => l.source === 'session')!
    expect(session.rows).toBe(3)
    expect(new Set(session.blocks.map(b => b.row)).size).toBe(3)
  })

  it('reuses a row once its last run has finished', () => {
    const lanes = layoutNight([
      run({ startedAt: from, completedAt: from + HOUR }),
      run({ startedAt: from + 30 * 60_000, completedAt: from + 2 * HOUR }),
      run({ startedAt: from + 3 * HOUR, completedAt: from + 4 * HOUR }),
    ], from, to, to)

    const ritual = lanes.find(l => l.source === 'ritual')!
    expect(ritual.rows).toBe(2)
    // The third starts after both are done, so it goes back to the top row.
    expect(ritual.blocks[2]!.row).toBe(0)
  })

  it('does not let the minimum width push sequential runs apart', () => {
    // Two four-second runs a minute apart are floored to a clickable width, and
    // comparing drawn widths rather than real times would overlap them and
    // wrongly claim a second row.
    const lanes = layoutNight([
      run({ startedAt: from, completedAt: from + 4000 }),
      run({ startedAt: from + 60_000, completedAt: from + 64_000 }),
    ], from, to, to)

    expect(lanes.find(l => l.source === 'ritual')!.rows).toBe(1)
  })

  it('always reports at least one row, even when empty', () => {
    for (const lane of layoutNight([], from, to, to)) expect(lane.rows).toBe(1)
  })

  it('returns every lane in a fixed order', () => {
    // Colour and position follow the entity, so lanes never reorder by count.
    expect(layoutNight([], from, to, to).map(l => l.source)).toEqual(LANE_ORDER)
  })

  it('drops a run that finished before the window', () => {
    const lanes = layoutNight([
      run({ startedAt: from - 5 * HOUR, completedAt: from - 4 * HOUR }),
    ], from, to, to)

    expect(lanes.every(l => l.blocks.length === 0)).toBe(true)
  })

  it('clips a run that began before the window and says so', () => {
    const lanes = layoutNight([
      run({ startedAt: from - HOUR, completedAt: from + HOUR }),
    ], from, to, to)

    const block = lanes.find(l => l.source === 'ritual')!.blocks[0]!
    expect(block.left).toBe(0)
    expect(block.clippedStart).toBe(true)
    // Only the hour inside the window is drawn, not the two it really ran.
    expect(block.width).toBeCloseTo(1 / 12, 4)
  })

  it('never draws past the right edge', () => {
    const lanes = layoutNight([
      run({ status: 'running', startedAt: to - HOUR, completedAt: undefined }),
    ], from, to, to)

    const block = lanes.find(l => l.source === 'ritual')!.blocks[0]!
    expect(block.left + block.width).toBeLessThanOrEqual(1.0001)
  })

  it('floors a very short run to something clickable', () => {
    const lanes = layoutNight([
      run({ startedAt: from + HOUR, completedAt: from + HOUR + 2000 }),
    ], from, to, to)

    expect(lanes.find(l => l.source === 'ritual')!.blocks[0]!.width).toBe(MIN_WIDTH)
  })
})

describe('hour ticks', () => {
  it('lands on the hour, not on the window edge', () => {
    const from = NOON + 17 * 60_000
    const ticks = hourTicks(from, from + 6 * HOUR)

    expect(ticks.length).toBeGreaterThan(0)
    for (const tick of ticks) expect(new Date(tick.at).getMinutes()).toBe(0)
  })

  it('labels sparsely so twenty-four of them do not collide', () => {
    const from = new Date(2026, 7, 10, 0, 0, 0).getTime()
    const ticks = hourTicks(from, from + 24 * HOUR, 3)

    const labelled = ticks.filter(t => t.label)
    expect(labelled.length).toBeLessThan(ticks.length)
    for (const tick of labelled) expect(new Date(tick.at).getHours() % 3).toBe(0)
  })

  it('stays inside the window', () => {
    const from = NOON
    for (const tick of hourTicks(from, from + 5 * HOUR)) {
      expect(tick.left).toBeGreaterThanOrEqual(0)
      expect(tick.left).toBeLessThanOrEqual(1)
    }
  })
})

describe('the spend curve', () => {
  const from = NOON
  const to = NOON + 12 * HOUR

  it('is empty when nothing cost anything', () => {
    expect(spendCurve([run(), run()], from, to, to)).toEqual({ points: [], total: 0 })
  })

  it('accumulates and opens from zero', () => {
    const curve = spendCurve([
      run({ completedAt: from + HOUR, costUsd: 0.5 }),
      run({ completedAt: from + 2 * HOUR, costUsd: 1.5 }),
    ], from, to, to)

    expect(curve.total).toBe(2)
    expect(curve.points[0]).toMatchObject({ left: 0, value: 0 })
    expect(curve.points.at(-1)!.cumulative).toBe(2)
    // Normalised, so the curve's shape is what is read rather than its height.
    expect(curve.points.at(-1)!.value).toBe(1)
  })

  it('holds the total flat to the right edge', () => {
    // A cumulative total does not fall. Ending the curve at the last charge
    // leaves a cliff in the area under it, which reads as spend going back to
    // nothing.
    const curve = spendCurve([run({ completedAt: from + HOUR, costUsd: 0.5 })], from, to, to)
    const last = curve.points.at(-1)!

    expect(last.left).toBe(1)
    expect(last.cumulative).toBe(0.5)
    expect(last.value).toBe(1)
  })

  it('does not add a flat tail when the last charge is already at the edge', () => {
    const curve = spendCurve([run({ completedAt: to, costUsd: 0.5 })], from, to, to)
    expect(curve.points.filter(p => p.left === 1)).toHaveLength(1)
  })

  it('rises monotonically', () => {
    const curve = spendCurve([
      run({ completedAt: from + 3 * HOUR, costUsd: 0.2 }),
      run({ completedAt: from + HOUR, costUsd: 0.9 }),
      run({ completedAt: from + 2 * HOUR, costUsd: 0.4 }),
    ], from, to, to)

    const values = curve.points.map(p => p.value)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })
})

describe('the headline figures', () => {
  it('counts each outcome once', () => {
    const summary = summarizeNight([
      run(),
      run({ status: 'failed' }),
      run({ needsAttention: true }),
      run({ status: 'cancelled' }),
    ], NOON + 5 * HOUR)

    expect(summary.total).toBe(4)
    expect(summary.byOutcome).toMatchObject({ succeeded: 1, failed: 1, attention: 1, cancelled: 1 })
  })

  it('adds up what the night cost', () => {
    const summary = summarizeNight([
      run({ costUsd: 0.4 }),
      run({ costUsd: 1.1 }),
      run(),
    ], NOON + 5 * HOUR)

    expect(summary.costUsd).toBeCloseTo(1.5, 6)
  })

  it('measures the busiest hour in time spent, not runs started', () => {
    // Twelve four-second commands at 14:00 is not a busier hour than one build
    // that ran for forty minutes.
    const twoAm = new Date(2026, 7, 10, 2, 0, 0).getTime()
    const twoPm = new Date(2026, 7, 10, 14, 0, 0).getTime()

    const busy = summarizeNight([
      run({ startedAt: twoAm, completedAt: twoAm + 40 * 60_000 }),
      ...Array.from({ length: 12 }, (_, i) =>
        run({ startedAt: twoPm + i * 1000, completedAt: twoPm + i * 1000 + 4000 })),
    ], twoPm + HOUR)

    expect(busy.busiestHour?.hour).toBe(2)
  })

  it('splits a run across the hours it touched', () => {
    const elevenPm = new Date(2026, 7, 10, 23, 30, 0).getTime()
    const summary = summarizeNight([
      run({ startedAt: elevenPm, completedAt: elevenPm + HOUR }),
    ], elevenPm + 2 * HOUR)

    // Half an hour either side of midnight: 23 and 0 both got 30 minutes, so
    // whichever wins, it must not be credited the full hour.
    expect(summary.busiestHour!.ms).toBeCloseTo(30 * 60_000, -3)
  })

  it('has no busiest hour for an empty night', () => {
    expect(summarizeNight([], NOON).busiestHour).toBeNull()
  })

  it('does not hang on a zero-length run', () => {
    // A run with no duration must still advance the hour cursor.
    const summary = summarizeNight([run({ startedAt: NOON, completedAt: NOON })], NOON)
    expect(summary.total).toBe(1)
  })
})

describe('the window label', () => {
  it('names the day when the window crosses one', () => {
    // A 24-hour window ends at the clock time it started, so "18:27 → 18:27" is
    // accurate and reads as a bug.
    const to = new Date(2026, 7, 10, 18, 27).getTime()
    expect(formatWindowLabel(to - 24 * HOUR, to)).toBe('Aug 9 18:27 → now')
  })

  it('leaves the day out when it does not', () => {
    const to = new Date(2026, 7, 10, 18, 27).getTime()
    expect(formatWindowLabel(to - 6 * HOUR, to)).toBe('12:27 → now')
  })
})

describe('formatting a duration', () => {
  it('reads compactly at every scale', () => {
    expect(formatDuration(400)).toBe('<1s')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(150_000)).toBe('2m 30s')
    expect(formatDuration(2 * HOUR + 5 * 60_000)).toBe('2h 5m')
  })
})

describe('stamping a time', () => {
  it('is bare when it is the same day as the reference', () => {
    const ref = new Date(2026, 7, 10, 18, 0).getTime()
    expect(formatStamp(new Date(2026, 7, 10, 6, 25).getTime(), ref)).toBe('06:25')
  })

  it('carries the day when it is not', () => {
    // Without this a correctly sorted table shows 06:25 above 17:25 and reads
    // as broken, because one of them is yesterday.
    const ref = new Date(2026, 7, 10, 18, 0).getTime()
    expect(formatStamp(new Date(2026, 7, 9, 17, 25).getTime(), ref)).toBe('Aug 9 17:25')
  })
})
