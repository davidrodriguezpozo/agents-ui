/**
 * The night, laid out.
 *
 * The claim this product is built on is that you can leave it running and come
 * back to what it did. Every number behind that already existed — a run's start,
 * its duration, its cost, how it ended — and all of it was only ever a list.
 * A list is the wrong shape for the question: "was my machine busy at 03:00" and
 * "did the 08:00 ritual overlap the check that made it wait" are questions about
 * *when*, and a table sorted by recency cannot answer either.
 *
 * So this turns runs into positions on a shared time axis. Nothing here touches
 * the DOM — the layout is arithmetic, which is the only reason it can be tested,
 * and lane packing is exactly the part that goes subtly wrong.
 */

import type { RunSource } from '~/composables/useRuns'

/**
 * How a run ended, for the purpose of colour.
 *
 * Five classes, deliberately: `attention` is not a kind of failure. Those runs
 * report success while having skipped the part that needed a permission, and
 * folding them into either neighbour is how a night that quietly did half its
 * work looks like a night that worked.
 */
export type NightOutcome = 'running' | 'succeeded' | 'attention' | 'failed' | 'cancelled'

export interface TimelineRun {
  id: string
  title: string
  source: RunSource
  status: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  durationMs?: number
  costUsd?: number
  needsAttention?: boolean
  deniedTools?: string[]
  refusedHosts?: string[]
  stoppedBy?: 'budget' | 'turns'
  scheduleId?: string
  sessionId?: string
}

export interface NightBlock {
  run: TimelineRun
  outcome: NightOutcome
  /** Fraction of the window, 0–1, clamped to it. */
  left: number
  width: number
  /** Which sub-row inside its lane, once overlaps are packed apart. */
  row: number
  startedAt: number
  endedAt: number
  /** True when the run began before the window did and is drawn cut off. */
  clippedStart: boolean
}

export interface NightLane {
  source: RunSource
  blocks: NightBlock[]
  /** How many sub-rows this lane needed. Always at least 1. */
  rows: number
}

export interface NightTick {
  at: number
  left: number
  /** Only some ticks carry text; the rest are hairlines. */
  label: string | null
}

/**
 * A run still going has no end, and "no end" cannot be drawn.
 *
 * Given the current time it becomes a block that reaches the right edge, which
 * is also what it looks like: something still happening.
 */
export function endOf(run: TimelineRun, now: number): number {
  if (run.completedAt) return run.completedAt
  if (run.status === 'running' || run.status === 'queued') return now
  // Finished without recording an end: fall back to its duration, then to the
  // start, which draws a tick rather than a bar reaching the edge and implying
  // it ran all night.
  const start = startOf(run)
  return run.durationMs ? start + run.durationMs : start
}

export function startOf(run: TimelineRun): number {
  return run.startedAt ?? run.createdAt
}

export function classify(run: TimelineRun): NightOutcome {
  if (run.status === 'running' || run.status === 'queued') return 'running'
  if (run.status === 'cancelled') return 'cancelled'
  if (run.status === 'failed') return 'failed'

  // Checked after the hard failures, because a run can be both and the failure
  // is the more useful thing to say about it.
  const held = Boolean(
    run.needsAttention
    || run.deniedTools?.length
    || run.refusedHosts?.length
    || run.stoppedBy,
  )

  return held ? 'attention' : 'succeeded'
}

/** The order lanes appear in, and the only order they ever appear in. */
export const LANE_ORDER: RunSource[] = ['ritual', 'session', 'agent', 'command']

/**
 * Below this a block is a sliver nobody can point at.
 *
 * A run lasting four seconds is a rounding error on a 24-hour axis, and drawing
 * it truthfully means drawing nothing. So it gets a floor — which makes the
 * *width* of a short block a lie, and is why width is never the thing being read:
 * duration is in the tooltip and the table, and the axis carries the rest.
 */
export const MIN_WIDTH = 0.0035

/**
 * Runs into lanes, with overlaps stacked rather than drawn on top of each other.
 *
 * Greedy interval packing per lane: walk the blocks in start order and drop each
 * into the first sub-row whose last block has already finished. Two sessions
 * running at once is the normal case here rather than an edge case — that is what
 * worktrees are *for* — so a single row per source would draw one session's night
 * over the top of another's and lose it.
 */
export function layoutNight(
  runs: TimelineRun[],
  from: number,
  to: number,
  now: number,
): NightLane[] {
  const span = Math.max(1, to - from)

  const lanes: NightLane[] = LANE_ORDER.map(source => ({ source, blocks: [], rows: 1 }))

  for (const lane of lanes) {
    const mine = runs
      .filter(run => run.source === lane.source)
      .map((run) => {
        const startedAt = startOf(run)
        const endedAt = Math.max(startedAt, endOf(run, now))
        return { run, startedAt, endedAt }
      })
      // Anything wholly outside the window is not this night's business.
      .filter(item => item.endedAt >= from && item.startedAt <= to)
      .sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt)

    /** The end of the last block placed in each sub-row. */
    const rowEnds: number[] = []

    for (const item of mine) {
      const visibleStart = Math.max(from, item.startedAt)
      const visibleEnd = Math.min(to, item.endedAt)

      const left = (visibleStart - from) / span
      const width = Math.max(MIN_WIDTH, (visibleEnd - visibleStart) / span)

      // Compared on real time rather than on the drawn width, so the minimum
      // above cannot push two genuinely sequential runs onto separate rows.
      let row = rowEnds.findIndex(end => end <= item.startedAt)
      if (row === -1) {
        row = rowEnds.length
        rowEnds.push(item.endedAt)
      } else {
        rowEnds[row] = item.endedAt
      }

      lane.blocks.push({
        run: item.run,
        outcome: classify(item.run),
        left: clamp01(left),
        // Never past the right edge, or a long run widens the whole chart.
        width: Math.min(width, 1 - clamp01(left)),
        row,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        clippedStart: item.startedAt < from,
      })
    }

    lane.rows = Math.max(1, rowEnds.length)
  }

  return lanes
}

/**
 * Hour marks across the window, labelled sparsely.
 *
 * A label every hour is twenty-four labels colliding on a phone. `labelEvery`
 * is in hours and the rest stay as hairlines, so the grid keeps its rhythm
 * without the axis becoming a wall of text.
 */
export function hourTicks(from: number, to: number, labelEvery = 3): NightTick[] {
  const span = Math.max(1, to - from)
  const ticks: NightTick[] = []

  const first = new Date(from)
  first.setMinutes(0, 0, 0)
  let at = first.getTime()
  if (at < from) at += 3_600_000

  for (; at <= to; at += 3_600_000) {
    const hour = new Date(at).getHours()
    ticks.push({
      at,
      left: (at - from) / span,
      label: hour % labelEvery === 0 ? `${String(hour).padStart(2, '0')}:00` : null,
    })
  }

  return ticks
}

export interface SpendPoint {
  left: number
  /** Cumulative spend up to here, as a fraction of the night's total. */
  value: number
  at: number
  cumulative: number
}

/**
 * Money spent across the night, as a running total.
 *
 * Its own series on the same x axis rather than a second y axis on the lanes —
 * two scales sharing one plot invent a correlation that is not in the data, and
 * the thing worth seeing here is only the shape: whether the cost arrived in one
 * lump at 03:00 or accumulated evenly.
 */
export function spendCurve(runs: TimelineRun[], from: number, to: number, now: number): {
  points: SpendPoint[]
  total: number
} {
  const span = Math.max(1, to - from)

  const charged = runs
    .filter(run => (run.costUsd ?? 0) > 0)
    .map(run => ({ at: Math.min(to, Math.max(from, endOf(run, now))), cost: run.costUsd! }))
    .sort((a, b) => a.at - b.at)

  const total = charged.reduce((sum, item) => sum + item.cost, 0)
  if (!total) return { points: [], total: 0 }

  // Opens at zero on the left edge so the curve starts from the floor rather
  // than from wherever the first run happened to be.
  const points: SpendPoint[] = [{ left: 0, value: 0, at: from, cumulative: 0 }]
  let cumulative = 0

  for (const item of charged) {
    cumulative += item.cost
    points.push({
      left: (item.at - from) / span,
      value: cumulative / total,
      at: item.at,
      cumulative,
    })
  }

  /**
   * Held flat to the right edge.
   *
   * A cumulative total does not fall, but a curve that stops at the last charge
   * leaves the area under it ending in a cliff — which reads as spend dropping
   * back to nothing at 15:00. Nothing was spent after that; the total is still
   * the total, and this is what says so.
   */
  const last = points.at(-1)!
  if (last.left < 1) {
    points.push({ left: 1, value: last.value, at: to, cumulative: last.cumulative })
  }

  return { points, total }
}

export interface NightSummary {
  total: number
  byOutcome: Record<NightOutcome, number>
  costUsd: number
  /**
   * The hour of the day with the most run-minutes in it, or null when the night
   * was empty. Measured in time spent rather than in runs started, because
   * "busiest" means the machine was working — twelve four-second commands at
   * 14:00 is not a busier hour than one build that ran for forty minutes.
   */
  busiestHour: { hour: number; ms: number } | null
}

export function summarizeNight(runs: TimelineRun[], now: number): NightSummary {
  const byOutcome: Record<NightOutcome, number> = {
    running: 0, succeeded: 0, attention: 0, failed: 0, cancelled: 0,
  }

  let costUsd = 0
  const perHour = new Map<number, number>()

  for (const run of runs) {
    byOutcome[classify(run)]++
    costUsd += run.costUsd ?? 0

    // Split across every hour it touched, so a run spanning midnight counts in
    // both rather than landing wholly in the hour it started.
    const start = startOf(run)
    const end = Math.max(start, endOf(run, now))

    for (let cursor = start; cursor <= end;) {
      const hourStart = new Date(cursor)
      hourStart.setMinutes(0, 0, 0)
      const hourEnd = hourStart.getTime() + 3_600_000
      const slice = Math.min(end, hourEnd) - cursor

      const hour = hourStart.getHours()
      perHour.set(hour, (perHour.get(hour) ?? 0) + Math.max(0, slice))

      // A zero-length run would otherwise never advance past its own hour.
      cursor = hourEnd <= cursor ? cursor + 3_600_000 : hourEnd
    }
  }

  let busiestHour: NightSummary['busiestHour'] = null
  for (const [hour, ms] of perHour) {
    if (ms > 0 && (!busiestHour || ms > busiestHour.ms)) busiestHour = { hour, ms }
  }

  return { total: runs.length, byOutcome, costUsd, busiestHour }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** `0.42` → `42m`, `3_600_000` → `1h 0m`. Compact enough for a tooltip. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function formatClock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A time, with its day only when the day is in doubt.
 *
 * Any window longer than the hours so far today contains two of every clock
 * time, and a column of bare `HH:MM` then reads as mis-sorted: a list correctly
 * ordered newest-first shows 06:25 above 17:25, and the reader concludes the
 * sort is broken rather than that one of them is yesterday.
 */
export function formatStamp(at: number, reference: number): string {
  const d = new Date(at)
  if (d.toDateString() === new Date(reference).toDateString()) return formatClock(at)

  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${formatClock(at)}`
}

/**
 * What the window covers, said once.
 *
 * A 24-hour window ends at the same clock time it starts, so the obvious
 * "18:27 → 18:27" is accurate and reads as a bug. The day is what disambiguates
 * it, and it is only worth printing when the window actually crosses one.
 */
export function formatWindowLabel(from: number, to: number): string {
  return `${formatStamp(from, to)} → now`
}
