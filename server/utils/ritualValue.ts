import type { OutcomeGroup } from './outcomes'
import type { RitualOutcome } from './ritualHistory'

/**
 * Whether a ritual is worth what it costs.
 *
 * `ritualHealth.ts` answers the reliability question: three firings in a row
 * that came to nothing and the scheduler stops firing it. That catches rituals
 * that are broken. It says nothing about the ones that work perfectly, cost
 * real money every morning and produce nothing anybody uses — the other way a
 * ritual outlives its usefulness, and much the commoner one. "Forty-one dollars
 * in three weeks, nothing landed" is a different sentence from "failing", and
 * only one of them ever gets acted on.
 *
 * Two things make this harder than spend divided by merges:
 *
 *   - **Not every ritual is meant to land code.** A morning briefing's output
 *     is a message. Judged on merges it scores nothing every week of its life,
 *     and a row calling it worthless would be wrong, loudly, about the most
 *     useful thing on the page. So what a ritual is for is a property of the
 *     ritual — set on the record when somebody knows, and otherwise read off
 *     whether it has landed anything.
 *   - **Two runs are not evidence.** The same reasoning as `GIVE_UP_AFTER`:
 *     under three firings there is nothing to conclude, and a verdict there is
 *     a guess wearing a number.
 *
 * Pure, over figures somebody else joined. The spend and the landings come from
 * `joinOutcomes`, which is the only thing that knows how to attribute either;
 * recomputing them here would be a second answer to a question that already has
 * one, and the two would eventually disagree on a page that shows both.
 */

/** What a ritual is for, and therefore what it should be judged on. */
export type RitualExpectation =
  /** Work that is supposed to end up in a base branch. */
  | 'code'
  /** A briefing, a triage, a message. Nothing merges, and nothing should. */
  | 'report'

/**
 * Firings below which there is no verdict.
 *
 * Three, for the reason `GIVE_UP_AFTER` is three: two is a coincidence. A
 * ritual set up on Monday must not be told on Wednesday that it does not earn
 * its keep.
 */
export const ENOUGH_RUNS = 3

/**
 * Spend below which "it landed nothing" is not worth saying loudly.
 *
 * A ritual that costs a dollar a month and lands nothing is a question of taste,
 * not of money, and a warning about it teaches people to ignore warnings. Above
 * this the row says it plainly and leaves the switch to a person — turning a
 * ritual off on cost is deliberately not something this does by itself.
 */
export const REAL_MONEY_USD = 5

/** How loudly the row should carry the verdict. */
export type RitualValueTone =
  /** It is doing what it is for. */
  | 'good'
  /** A statement of fact with nothing to act on. */
  | 'plain'
  /** Somebody should decide whether to keep this. */
  | 'warn'

export interface RitualValueInput {
  /**
   * What the ritual record says it is for. Absent means nobody has said, and
   * it is read off the landings instead.
   */
  expects?: RitualExpectation
  /**
   * One entry per firing in the window, chains already collapsed — a six-step
   * chain is one thing that happened, not six. See `collapseChainRuns`.
   */
  firings: { outcome: RitualOutcome; interrupted?: boolean }[]
  /**
   * This ritual's slice of `joinOutcomes`. Absent when it had no turn in the
   * window at all, which is not the same as one that cost nothing.
   */
  group?: Pick<OutcomeGroup, 'costUsd' | 'landings' | 'costPerLandingUsd'>
  /** Whole days the figures cover, so the sentence can say so. */
  days: number
}

export interface RitualValue {
  expects: RitualExpectation
  /**
   * Nothing on the ritual said what it was for, so this was read off the
   * records. The row says so, because it is the one number here a person can
   * correct.
   */
  assumed: boolean
  days: number
  /** Firings in the window, however many runs each was. */
  runs: number
  /**
   * Firings that finished and produced nothing: refused a tool, or failed.
   * A firing the machine lost is not counted — it says nothing about the
   * ritual, the same judgement `summarizeRitualRuns` makes about the streak.
   */
  emptyRuns: number
  costUsd: number
  landings: number
  /**
   * What this ritual spent on the sessions that landed, over those landings.
   * Null when it landed nothing. Indicative, like every dollar figure built on
   * `joinOutcomes` — see the note at the top of `outcomes.ts`.
   */
  costPerLandingUsd: number | null
  /** The whole judgement, in one line, for the row. */
  verdict: string
  tone: RitualValueTone
}

/** Two places, so a column of these lines up with the ledger's. */
function money(usd: number): string {
  return `$${usd.toFixed(2)}`
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

function period(days: number): string {
  return days === 1 ? 'the last day' : `the last ${days} days`
}

/**
 * What a ritual has cost, what came of it, and whether that is a problem.
 *
 * The order of the rules is the argument. Too little evidence beats everything,
 * because a number over two runs is noise. "Every run came to nothing" beats
 * the value question, because a ritual that is not working is a reliability
 * problem and saying anything about its value would bury that. Only then does
 * what the ritual is *for* decide which sentence it gets.
 */
export function ritualValueOf(input: RitualValueInput): RitualValue {
  const runs = input.firings.length
  const emptyRuns = input.firings.filter(
    firing => !firing.interrupted && (firing.outcome === 'failed' || firing.outcome === 'blocked'),
  ).length

  const costUsd = input.group?.costUsd ?? 0
  const landings = input.group?.landings.total ?? 0
  const costPerLandingUsd = landings > 0 ? input.group?.costPerLandingUsd ?? null : null

  // Nobody said, so the records answer: a ritual that has landed something is
  // one that lands, and a ritual that never has is taken to be reporting. The
  // conservative way round — the cost of guessing "reports" is a briefing that
  // is never nagged about, and the cost of guessing "code" is the page calling
  // that briefing a waste of money.
  const expects: RitualExpectation = input.expects ?? (landings > 0 ? 'code' : 'report')
  const assumed = input.expects === undefined

  const over = `over ${runs} ${plural(runs, 'run', 'runs')} in ${period(input.days)}`
  const base = { expects, assumed, days: input.days, runs, emptyRuns, costUsd, landings, costPerLandingUsd }

  if (runs === 0) {
    return { ...base, verdict: `It has not run in ${period(input.days)}.`, tone: 'plain' }
  }

  if (runs < ENOUGH_RUNS) {
    return {
      ...base,
      verdict: `${money(costUsd)} ${over}. Too few to say whether it earns its keep.`,
      tone: 'plain',
    }
  }

  if (emptyRuns === runs) {
    return {
      ...base,
      verdict: `${money(costUsd)} ${over}, and every one of them came to nothing.`,
      tone: 'warn',
    }
  }

  if (expects === 'report') {
    // Said in the ritual's favour on purpose. Its output is a message, and a
    // row that scored it on merges would be reporting a fact about the wrong
    // thing every morning for the rest of its life.
    const verdict = landings > 0
      ? `${money(costUsd)} ${over}. It reports rather than lands, and ${landings} `
        + `${plural(landings, 'change', 'changes')} landed behind it anyway.`
      : `${money(costUsd)} ${over}. It reports rather than lands, so nothing merging is what it is for.`

    return { ...base, verdict, tone: landings > 0 ? 'good' : 'plain' }
  }

  if (landings > 0) {
    return {
      ...base,
      verdict: `${money(costUsd)} ${over}, ${landings} landed — `
        + `${money(costPerLandingUsd ?? 0)} a landing.`,
      tone: 'good',
    }
  }

  if (costUsd >= REAL_MONEY_USD) {
    return {
      ...base,
      verdict: `${money(costUsd)} ${over}, and nothing landed. Worth deciding whether to keep it.`,
      tone: 'warn',
    }
  }

  return {
    ...base,
    verdict: `${money(costUsd)} ${over}, and nothing landed — cheap either way.`,
    tone: 'plain',
  }
}
