import type { RunSummary } from './runStore'

/**
 * What a ritual's runs add up to.
 *
 * A ritual runs when nobody is watching, so the question its history has to
 * answer is not "what happened last time" but "has this quietly stopped
 * working?" — which needs the run before last, and the one before that.
 */

export type RitualOutcome = 'ok' | 'blocked' | 'failed' | 'stopped' | 'running'

export interface RitualRun {
  id: string
  at: number
  outcome: RitualOutcome
  durationMs?: number
  costUsd?: number
  /** Tools it was refused, which is why a `blocked` result is incomplete. */
  deniedTools?: string[]
  /** Hosts the sandbox refused it, the other way a run comes back incomplete. */
  refusedHosts?: string[]
  suggestedRules?: string[]
  error?: string
  preview: string
}

export interface RitualHistory {
  runs: RitualRun[]
  /**
   * How many of the most recent runs in a row came to nothing. Zero means the
   * last real attempt worked.
   */
  failingStreak: number
  /** When it last produced a usable result, if it ever has. */
  lastOkAt?: number
}

/** Everything needed to judge a run, so a live run can be judged too. */
export interface RunOutcomeFields {
  status: string
  needsAttention?: boolean
  deniedTools?: string[]
  refusedHosts?: string[]
}

/**
 * A completed run is not automatically a successful one: an unattended run that
 * was refused a tool it needed finishes "completed" with half the work missing.
 * That is the failure mode rituals actually have, so it gets its own outcome.
 *
 * A sandbox refusal counts the same way, and for the same reason — a briefing
 * that could not reach the API it summarises finished with nothing in it. It
 * also inherits the useful consequence: `blocked` is excluded from the retry a
 * failure gets, because running it again produces the identical refusal a
 * minute later, for money. What it needs is the host, not another attempt.
 */
export function outcomeOf(run: RunOutcomeFields): RitualOutcome {
  if (run.status === 'running' || run.status === 'queued') return 'running'
  if (run.status === 'cancelled') return 'stopped'
  if (run.status === 'failed') return 'failed'
  if (run.needsAttention || run.deniedTools?.length || run.refusedHosts?.length) return 'blocked'
  return 'ok'
}

/** `runs` must be newest first, as the run store returns them. */
export function summarizeRitualRuns(runs: RunSummary[]): RitualHistory {
  const history: RitualRun[] = runs.map(run => ({
    id: run.id,
    at: run.createdAt,
    outcome: outcomeOf(run),
    durationMs: run.durationMs,
    costUsd: run.costUsd,
    deniedTools: run.deniedTools,
    refusedHosts: run.refusedHosts,
    suggestedRules: run.suggestedRules,
    error: run.error,
    preview: run.preview,
  }))

  let failingStreak = 0
  for (const run of history) {
    // In-flight work has not gone wrong yet, and a run someone stopped by hand
    // says nothing about the ritual — neither breaks the streak nor extends it.
    if (run.outcome === 'running' || run.outcome === 'stopped') continue
    if (run.outcome === 'ok') break
    failingStreak++
  }

  return {
    runs: history,
    failingStreak,
    lastOkAt: history.find(r => r.outcome === 'ok')?.at,
  }
}
