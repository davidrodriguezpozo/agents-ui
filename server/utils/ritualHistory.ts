import type { RunSummary } from './runStore'
// A value import, where `ritualChain` takes only a type back — so the pair is
// not a cycle at runtime.
import { chainOutcome } from './ritualChain'

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
  /** The process went away mid-run, so this is not evidence about the ritual. */
  interrupted?: boolean
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

function toRitualRun(run: RunSummary): RitualRun {
  return {
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
    interrupted: run.interrupted,
  }
}

function sum(values: (number | undefined)[]): number | undefined {
  const present = values.filter((v): v is number => typeof v === 'number')
  return present.length ? present.reduce((a, b) => a + b, 0) : undefined
}

/**
 * One firing of a chained ritual, from the runs its steps produced.
 *
 * This is what makes a chain one thing rather than several, and it is needed in
 * two places for two different reasons — so it happens once, here, and both
 * take the result.
 *
 * In the **history** it is what stops a three-step chain failing once from
 * contributing three failures to the streak, which would turn the ritual off
 * after a single bad morning. In the **digest** it is what stops one thing
 * happening overnight from being three things to read about it. Those are the
 * two symptoms chains exist to cure, and they are the same collapse.
 *
 * The merged run describes the *firing*: it begins when the first step began,
 * costs what all the steps cost together, and takes its identity from the step
 * that decided the outcome — a chain that came to nothing came to nothing
 * somewhere in particular, and that is the run worth opening.
 *
 * What was refused is unioned across every step rather than taken from the
 * deciding one, because the digest offers to grant the rules a blocked run
 * asked for, and a rule asked for by step one is still the rule that is needed.
 */
function mergeFiring(steps: RunSummary[]): RunSummary {
  const outcome = chainOutcome(steps.map(outcomeOf))

  // Earliest first, so "where did this go wrong" is answered by the first step
  // that did rather than the last one to report.
  const inOrder = [...steps].sort((a, b) => a.createdAt - b.createdAt)
  const deciding = inOrder.find(step => outcomeOf(step) === outcome) ?? inOrder[inOrder.length - 1]!

  const union = (pick: (run: RunSummary) => string[] | undefined) =>
    [...new Set(steps.flatMap(step => pick(step) ?? []))].slice(0, 20)

  const deniedTools = union(step => step.deniedTools)
  const refusedHosts = union(step => step.refusedHosts)
  const suggestedRules = union(step => step.suggestedRules)

  return {
    ...deciding,
    createdAt: inOrder[0]!.createdAt,
    completedAt: steps.reduce<number | undefined>(
      (latest, step) => Math.max(latest ?? 0, step.completedAt ?? 0) || undefined,
      undefined,
    ),
    durationMs: sum(steps.map(step => step.durationMs)),
    costUsd: sum(steps.map(step => step.costUsd)),
    // `status` stays the deciding step's, which is what keeps `outcomeOf` on
    // the merged run agreeing with `chainOutcome` above.
    needsAttention: steps.some(step => step.needsAttention),
    // Any step losing the process ends the firing, and the deciding step is
    // picked by outcome rather than by that — so asking it alone would let a
    // restart mid-chain count against the ritual after all.
    interrupted: steps.some(step => step.interrupted) || undefined,
    deniedTools: deniedTools.length ? deniedTools : undefined,
    refusedHosts: refusedHosts.length ? refusedHosts : undefined,
    suggestedRules: suggestedRules.length ? suggestedRules : undefined,
  }
}

/**
 * Runs with each chain's steps merged into the one firing they were.
 *
 * `runs` must be newest first. The order is preserved: a firing takes the
 * position of its most recent step, and a chain's steps are contiguous in time,
 * so the result is still newest first.
 */
export function collapseChainRuns(runs: RunSummary[]): RunSummary[] {
  const out: RunSummary[] = []
  const groups = new Map<string, RunSummary[]>()
  const at = new Map<string, number>()

  for (const run of runs) {
    if (!run.chainId) {
      out.push(run)
      continue
    }

    const group = groups.get(run.chainId)
    if (!group) {
      groups.set(run.chainId, [run])
      at.set(run.chainId, out.length)
      out.push(run)
      continue
    }

    group.push(run)
    out[at.get(run.chainId)!] = mergeFiring(group)
  }

  return out
}

/** `runs` must be newest first, as the run store returns them. */
export function summarizeRitualRuns(runs: RunSummary[]): RitualHistory {
  const history: RitualRun[] = collapseChainRuns(runs).map(toRitualRun)

  let failingStreak = 0
  for (const run of history) {
    // In-flight work has not gone wrong yet, and a run someone stopped by hand
    // says nothing about the ritual — neither breaks the streak nor extends it.
    //
    // A run the *server* stopped is the same class and was missing from it. A
    // deploy, a crash or a reboot mid-run marks the record `failed`, and three
    // of those in a row turned the ritual off — so working on this app was a
    // way to silently disable the briefing it runs every morning. Found on a
    // real machine: `Morning brief` sat at two, one restart from being stopped,
    // with nothing wrong with it.
    //
    // The clincher is that the system already disagrees with itself here.
    // `resumeInterruptedRituals` puts the ritual's clock back so the lost
    // occurrence fires again — an interruption is explicitly treated as worth
    // retrying, and counting the same event as evidence the ritual is broken
    // cannot also be right.
    if (run.outcome === 'running' || run.outcome === 'stopped' || run.interrupted) continue
    if (run.outcome === 'ok') break
    failingStreak++
  }

  return {
    runs: history,
    failingStreak,
    lastOkAt: history.find(r => r.outcome === 'ok')?.at,
  }
}
