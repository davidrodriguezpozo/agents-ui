import { runsSince } from './runStore'
import { readSessions } from './sessions'
import { readPreferences } from './preferences'
import { quotaBlocks, quotaReason, readQuota } from './quota'

/**
 * Spending limits that actually stop things.
 *
 * The spend page could already tell you what a day had cost, which answers the
 * question a day late. It never stopped anything: six parallel sessions and a
 * ritual firing at 08:00 with nobody watching can spend real money before
 * anyone is awake to see the chart.
 *
 * Two limits, enforced in different ways because they have to be:
 *
 *   - A **per-run** limit is handed to the SDK as `maxBudgetUsd`, which stops
 *     the query mid-flight. This is the only way to catch a single run going
 *     wrong, and it works without us keeping a price list that would go stale
 *     the week a model changed. It is checked between turns, so a single
 *     expensive turn overshoots it before anything notices — measured at six
 *     cents against a one cent limit. "Stop after about this", not a ceiling,
 *     and the settings copy says so rather than implying a guarantee.
 *   - A **daily** limit is ours to enforce, since the SDK knows nothing about
 *     what everything else has spent today. Checked before a run starts.
 *
 * The two compose: whatever is left of the day's allowance becomes the ceiling
 * handed to the SDK, so a single run cannot walk past the daily limit either.
 */

/** Midnight where the person is standing, which is what "today" means to them. */
export function startOfToday(now: number): number {
  return new Date(now).setHours(0, 0, 0, 0)
}

/**
 * What has been spent since a moment, across everything that costs money.
 *
 * Includes session summaries, which never enter the run log — leaving them out
 * would make the limit quietly generous, and a limit you cannot trust is worse
 * than none.
 */
export async function spentSince(since: number): Promise<number> {
  const [runs, sessions] = await Promise.all([runsSince(since), readSessions()])

  const fromRuns = runs.reduce((total, run) => total + (run.costUsd ?? 0), 0)
  const fromSummaries = sessions.reduce(
    (total, session) => total + (session.summary && session.summary.at >= since ? session.summary.costUsd : 0),
    0,
  )

  return fromRuns + fromSummaries
}

export interface BudgetDecision {
  /** False means do not start this at all. */
  allowed: boolean
  /** Why not, in words worth showing someone. */
  reason?: string
  /**
   * The ceiling to hand the SDK for this run, or undefined for no ceiling.
   * Already the smaller of the per-run limit and what is left of today.
   */
  maxBudgetUsd?: number
  /** What has gone today, so callers can say how close this was. */
  spentToday: number
  dailyCapUsd?: number
}

function money(usd: number): string {
  return usd < 0.01 && usd > 0 ? '<$0.01' : `$${usd.toFixed(2)}`
}

/**
 * Whether a run may start, and what it may spend.
 *
 * Never throws and never blocks on a limit it could not read: an unreadable
 * preferences file must not become an outage that stops every session and
 * ritual on the machine. Failing open is right here — the limits are a
 * convenience against runaway spend, not a security boundary.
 */
export async function checkBudget(
  now = Date.now(),
  opts: { unattended?: boolean } = {},
): Promise<BudgetDecision> {
  let dailyCapUsd: number | undefined
  let runCapUsd: number | undefined
  let pauseOnQuotaWarning = false

  try {
    const prefs = await readPreferences()
    dailyCapUsd = prefs.dailyCapUsd || undefined
    runCapUsd = prefs.runCapUsd || undefined
    pauseOnQuotaWarning = prefs.pauseOnQuotaWarning
  } catch {
    return { allowed: true, spentToday: 0 }
  }

  /**
   * The subscription's own limit, which for anyone on Pro or Max is the one
   * that actually stops their work — the dollar caps below describe money they
   * are never billed.
   *
   * Only ever applied to work nobody asked for right now. A turn you typed is
   * yours to spend: you can see the state of your own account, and being
   * refused by your own tool for something you deliberately started is the
   * wrong side of helpful.
   */
  if (opts.unattended && pauseOnQuotaWarning) {
    const quota = await readQuota()
    if (quotaBlocks(quota, now)) {
      return { allowed: false, reason: quotaReason(quota!), spentToday: 0 }
    }
  }

  if (!dailyCapUsd && !runCapUsd) return { allowed: true, spentToday: 0 }

  let spentToday = 0
  try {
    spentToday = await spentSince(startOfToday(now))
  } catch {
    // Cannot tell what today cost, so cannot claim it is over. The per-run
    // ceiling still applies, which is the one that stops a runaway.
    return { allowed: true, maxBudgetUsd: runCapUsd, spentToday: 0 }
  }

  if (dailyCapUsd && spentToday >= dailyCapUsd) {
    return {
      allowed: false,
      reason: `Today has cost ${money(spentToday)}, which is at the ${money(dailyCapUsd)} daily limit. `
        + 'Raise it in Settings, or leave this until tomorrow.',
      spentToday,
      dailyCapUsd,
    }
  }

  const remainingToday = dailyCapUsd ? dailyCapUsd - spentToday : undefined

  // The tighter of the two, so neither can be walked past.
  const maxBudgetUsd = [runCapUsd, remainingToday]
    .filter((v): v is number => typeof v === 'number' && v > 0)
    .reduce<number | undefined>((min, v) => (min === undefined ? v : Math.min(min, v)), undefined)

  return { allowed: true, maxBudgetUsd, spentToday, dailyCapUsd }
}

/**
 * Shown when a run was stopped for reaching its turn limit.
 *
 * Here rather than in either provider because both of them stop runs for it and
 * the sentence has to be the same one — a reader who has seen it on a Claude run
 * should recognise it on a Cursor run, and two copies of it is how one of them
 * ends up describing a limit that has since been renamed.
 *
 * Claude Code stops itself and reports `error_max_turns`; Cursor has no turn
 * limit of its own, so the adapter counts model calls and stops the process. The
 * ending is the same either way, which is the point of saying it once.
 */
export function turnsStoppedMessage(maxTurns: number): string {
  return `This run reached its limit of ${maxTurns} turns and was stopped, so the work is unfinished.`
}

/** Shown when the SDK stopped a run for hitting the ceiling it was given. */
export function budgetStoppedMessage(limitUsd: number | undefined): string {
  return limitUsd
    ? `This run reached its ${money(limitUsd)} spending limit and was stopped, so the work is unfinished. `
      + 'Raise the limit in Settings, or send it again to carry on from here.'
    : 'This run reached its spending limit and was stopped, so the work is unfinished.'
}
