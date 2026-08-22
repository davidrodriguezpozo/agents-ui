import {
  joinOutcomes, outcomeTurnOf,
  type OutcomeReport, type OutcomeRunRecord, type OutcomeSession, type OutcomeTotals,
} from './outcomes'
import { personKey } from './identity'
import type { SideCost } from './spend'

/**
 * What the work that actually shipped cost.
 *
 * `outcomes.ts` is the join and answers one window at a time. That is not yet a
 * page: the question anybody has is not "what did the last seven days cost per
 * merge" but "is that better or worse than the seven before it", and a page that
 * computed the second half itself would be arithmetic in a template — the place
 * this app has twice found a number nobody could reproduce. So the pairing lives
 * here, with tests, and the page renders what it is handed.
 *
 * Three decisions are worth naming, because each one could have been made the
 * flattering way:
 *
 *   - **The window is a count of whole local days, and the one before it is the
 *     same count.** Not "this calendar week", which on a Tuesday compares two
 *     days against seven and reports a triumph. `/api/spend` already draws its
 *     chart off whole local days from the start of the earliest one, and the
 *     ledger has to agree with it or one of them is lying. The current window
 *     does run short by whatever is left of today — it ends now, not at
 *     midnight — which is why what it compares is a *ratio*: cost per landing
 *     survives a window being cut off partway, where a total would not. The
 *     page says the window includes today.
 *   - **A change is only reported when both windows have a merge.** Zero merges
 *     is not an infinitely expensive merge and it is not a free one; it is a
 *     window with no answer, and `null` is how that is said.
 *   - **"Nothing merged" excludes open sessions.** Spend on a session still
 *     going is not yet a loss, and counting it as one would make every busy
 *     Friday look like a write-off. What it does include is spend no session
 *     owns — a ritual's nightly briefing is real output, but it is not a merge,
 *     and this column exists to be the number that gets a bad ritual deleted.
 *   - **Merges that did not hold are counted as of now, in both windows.** So the
 *     earlier window has had longer for its merges to be reverted than the
 *     current one has, and the two counts are not a fair comparison with each
 *     other. They are not paired into a change figure for that reason — only
 *     cost per merge is. The page says the count is as of today.
 *   - **The person column adds up to less than the total, always.** Rituals name
 *     nobody, and neither does anything recorded before identity existed. Both
 *     are left out rather than pooled into a row, because a row called
 *     "unattributed" sitting at the top of a table of colleagues reads like a
 *     person with a strange name and a large bill. The page says where the gap
 *     comes from instead.
 *
 * Every dollar figure here is as indicative as the ones it is built from: on a
 * subscription nothing is billed per turn, and a session's cost includes the
 * turns that were somebody changing their mind. See the note at the top of
 * `outcomes.ts`. The page says so once, in words.
 */

/** Windows on offer. Longer than this means holding the whole run log in memory twice. */
export const LEDGER_DAYS = [7, 14, 30] as const

export const MAX_LEDGER_DAYS = 90

export interface LedgerWindow {
  days: number
  /** Start of the earliest whole local day in the window. */
  since: number
  until: number
  /** The same number of whole days, immediately before. */
  previousSince: number
  previousUntil: number
}

/**
 * The two windows, from a day count and a clock.
 *
 * `setHours(0, 0, 0, 0)` on a local `Date` rather than arithmetic on the
 * timestamp, so a window that spans a daylight-saving change still starts at
 * midnight — the same way `/api/spend` seeds its chart.
 */
export function ledgerWindow(days: number, now: number): LedgerWindow {
  const whole = Math.max(1, Math.min(Math.floor(days) || 0, MAX_LEDGER_DAYS))
  const startOfDayBack = (back: number) => new Date(now - back * 86_400_000).setHours(0, 0, 0, 0)

  const since = startOfDayBack(whole - 1)

  return {
    days: whole,
    since,
    until: now,
    previousSince: startOfDayBack(2 * whole - 1),
    // Ends the millisecond the current window begins, so no turn is counted twice.
    previousUntil: since - 1,
  }
}

export interface LedgerRow {
  /** The ritual id, agent slug, model name, repository path or person. */
  key: string
  /**
   * What to call it, when the key is not the name. Rituals have one — their key
   * is a generated id, and a table row reading `k3f9x-a1` names nothing — and so
   * do people, whose key is an email and whose name is what a colleague reads.
   * Absent means the key is the name.
   */
  label?: string
  turns: number
  costUsd: number
  landings: number
  /**
   * Of those landings, the ones whose work has since been taken back out.
   *
   * Never above `landings`, and not a judgement on the group: a revert is
   * frequently the right thing to have happened. It is here because a table of
   * cost per merge with no column for merges that did not hold is a table that
   * cannot be wrong about anything. See `revertWatch.ts` — this is a floor.
   */
  revertedLandings: number
  /** Indicative, and null when this group landed nothing in the window. */
  costPerLandingUsd: number | null
  /** Spend that will not be credited to a merge: set aside, or owned by nothing. */
  unmergedCostUsd: number
  /** Spend on sessions still going — not yet a win and not yet a loss. */
  openCostUsd: number
}

export type LedgerDimension = 'ritual' | 'agent' | 'model' | 'repository' | 'person'

export interface LedgerTable {
  dimension: LedgerDimension
  /** Largest spend first, as `joinOutcomes` left them. */
  rows: LedgerRow[]
}

export interface Ledger {
  window: LedgerWindow
  current: OutcomeReport
  previous: OutcomeReport
  /**
   * Change in spend per landing, as a fraction of the earlier figure — 0.2 is a
   * fifth more expensive. Null when either window has no landing, because there
   * is nothing to compare it with.
   */
  perLandingChange: number | null
  tables: LedgerTable[]
}

export interface LedgerInput {
  /** Run records, not summaries — see `runRecordsSince`. */
  runs: OutcomeRunRecord[]
  sessions: OutcomeSession[]
  /** Model calls that cost money without being runs. Kept out of the totals. */
  side?: SideCost[]
  days: number
  now: number
  /** Ritual titles by id, so a row is a ritual's name and not its id. */
  ritualTitles?: Record<string, string>
}

/**
 * Spend in a group that no merge will ever be credited with.
 *
 * Sessions somebody set aside, plus every turn no session owns. Open sessions
 * are deliberately absent: their spend is unresolved, not wasted, and a column
 * that called it waste would be wrong about every session started today.
 */
export function unmergedCostUsd(totals: OutcomeTotals): number {
  return totals.abandonedCostUsd + totals.unattributedCostUsd
}

function rowsOf(groups: OutcomeReport['byRitual'], labels?: Record<string, string>): LedgerRow[] {
  return groups.map(group => ({
    key: group.key,
    label: labels?.[group.key],
    turns: group.turns,
    costUsd: group.costUsd,
    landings: group.landings.total,
    revertedLandings: group.revertedLandings,
    costPerLandingUsd: group.costPerLandingUsd,
    unmergedCostUsd: unmergedCostUsd(group),
    openCostUsd: group.openCostUsd,
  }))
}

/**
 * Names to put on the person rows, from the run log itself.
 *
 * A person's key is their email — see `personKey`, and the reason is that people
 * rewrite `user.name` — so a table keyed on it alone is a column of addresses.
 * The name is read back off the same records the grouping came from, which means
 * no store of people has to exist for the column to be readable: whoever sent a
 * turn wrote their name onto it at the time.
 *
 * Last spelling wins, and the runs arrive newest first, so a person who has
 * since corrected their name reads as they spell it now. Only set when it says
 * something the key does not — a repository with only a `user.name` keys on the
 * name, and a row labelled with its own key is noise.
 */
function personNames(runs: OutcomeRunRecord[]): Record<string, string> {
  const names: Record<string, string> = {}

  for (const run of runs) {
    const key = personKey(run.by)
    const name = run.by?.name?.trim()
    if (!key || !name || name === key) continue
    if (!(key in names)) names[key] = name
  }

  return names
}

/** The window a page asked for, the one before it, and the five breakdowns. */
export function buildLedger(input: LedgerInput): Ledger {
  const window = ledgerWindow(input.days, input.now)
  const turns = input.runs.map(outcomeTurnOf)
  const { sessions, side } = input

  const current = joinOutcomes({
    turns, sessions, side, since: window.since, until: window.until,
  })
  const previous = joinOutcomes({
    turns, sessions, side, since: window.previousSince, until: window.previousUntil,
  })

  const before = previous.costPerLandingUsd
  const after = current.costPerLandingUsd

  return {
    window,
    current,
    previous,
    perLandingChange: before !== null && after !== null && before > 0
      ? (after - before) / before
      : null,
    tables: [
      { dimension: 'ritual', rows: rowsOf(current.byRitual, input.ritualTitles) },
      { dimension: 'agent', rows: rowsOf(current.byAgent) },
      { dimension: 'model', rows: rowsOf(current.byModel) },
      { dimension: 'repository', rows: rowsOf(current.byRepository) },
      { dimension: 'person', rows: rowsOf(current.byPerson, personNames(input.runs)) },
    ],
  }
}
