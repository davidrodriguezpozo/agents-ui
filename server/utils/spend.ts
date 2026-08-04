import type { RunSummary } from './runStore'
import type { RunSource } from './runFilter'

/**
 * What this has cost.
 *
 * Every run records what it cost, and until now that number was only ever
 * visible one run at a time — which answers "was that expensive?" and never
 * "what am I spending?". The second question is the one that matters when
 * something runs on a schedule without being asked.
 */

export interface DaySpend {
  /** Local date, because a day means the one you lived through. */
  date: string
  cost: number
  runs: number
}

/**
 * Not every source is a run.
 *
 * Session summaries are model calls that deliberately never enter the run log
 * — one per turn would bury Activity in entries nobody asked for. But they do
 * cost money, and a spend page that omits them is not a spend page. So they
 * are counted here as their own line, which also happens to answer the only
 * question anyone has about the feature: is it worth what it costs.
 */
export type SpendSource = RunSource | 'summary'

export interface SourceSpend {
  source: SpendSource
  cost: number
  runs: number
}

/** A model call that cost something without being a run. */
export interface SideCost {
  source: Exclude<SpendSource, RunSource>
  costUsd: number
  at: number
}

export interface SpendSummary {
  total: number
  runs: number
  /** One entry per day in the window, including the days nothing ran. */
  byDay: DaySpend[]
  bySource: SourceSpend[]
  /** The handful worth looking at, largest first. */
  top: { id: string; title: string; cost: number; source: RunSource; at: number }[]
  /** Straight-line projection from this window, for a sense of scale only. */
  monthlyEstimate: number
}

/** A day is where you were standing, not where UTC was. */
export function localDay(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function summarizeSpend(
  runs: RunSummary[],
  days: number,
  now: number,
  /** Model calls that cost money without being runs — see SideCost. */
  side: SideCost[] = [],
): SpendSummary {
  const costed = runs.filter(run => typeof run.costUsd === 'number' && run.costUsd > 0)

  const byDayMap = new Map<string, DaySpend>()
  // Seeded with every day in the window so a quiet Sunday is a gap you can see
  // rather than a day the chart silently omits.
  for (let back = days - 1; back >= 0; back--) {
    const date = localDay(now - back * 86_400_000)
    byDayMap.set(date, { date, cost: 0, runs: 0 })
  }

  const bySourceMap = new Map<SpendSource, SourceSpend>()
  let total = 0

  for (const run of costed) {
    const cost = run.costUsd!
    total += cost

    const day = byDayMap.get(localDay(run.createdAt))
    if (day) {
      day.cost += cost
      day.runs += 1
    }

    const source = bySourceMap.get(run.source) ?? { source: run.source, cost: 0, runs: 0 }
    source.cost += cost
    source.runs += 1
    bySourceMap.set(run.source, source)
  }

  // Folded into the totals and the daily chart, but never into `top`: these
  // are fractions of a cent each and would only ever crowd out the runs that
  // are worth looking at.
  for (const entry of side) {
    if (!(entry.costUsd > 0)) continue
    total += entry.costUsd

    const day = byDayMap.get(localDay(entry.at))
    if (day) {
      day.cost += entry.costUsd
      day.runs += 1
    }

    const source = bySourceMap.get(entry.source) ?? { source: entry.source, cost: 0, runs: 0 }
    source.cost += entry.costUsd
    source.runs += 1
    bySourceMap.set(entry.source, source)
  }

  const top = [...costed]
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0))
    .slice(0, 5)
    .map(run => ({
      id: run.id,
      title: run.title,
      cost: run.costUsd ?? 0,
      source: run.source,
      at: run.createdAt,
    }))

  return {
    total,
    runs: costed.length + side.filter(s => s.costUsd > 0).length,
    byDay: [...byDayMap.values()],
    bySource: [...bySourceMap.values()].sort((a, b) => b.cost - a.cost),
    top,
    monthlyEstimate: days > 0 ? (total / days) * 30 : 0,
  }
}
