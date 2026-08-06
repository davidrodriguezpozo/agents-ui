import type { RitualHistory, RitualOutcome } from './ritualHistory'

/**
 * What to do about a ritual that isn't working.
 *
 * The history already knew how to say "this has quietly stopped working" —
 * `failingStreak` has been on the row for a while. Nothing acted on it, so a
 * ritual that broke on Tuesday went on failing every morning until somebody
 * noticed, spending money on each attempt to produce nothing.
 *
 * Two decisions, and they are deliberately different:
 *
 *   - **Retry**, once, when a run fails in a way that might not repeat. A
 *     morning briefing lost to a dropped connection is worth one more attempt
 *     ten minutes later; nobody is awake to press the button.
 *   - **Give up** once it is clear the thing is broken rather than unlucky.
 *     Stopping is the useful act here: it ends the waste, and it is the only
 *     way the next failure gets anyone's attention instead of joining a queue
 *     of identical ones nobody reads.
 *
 * Kept apart from the scheduler because they are judgements about a history,
 * which is the sort of thing worth testing without a clock or a filesystem.
 */

/**
 * Consecutive unproductive runs before the scheduler stops firing it.
 *
 * Three, because two is a coincidence and four is another day of waste. A
 * daily ritual gets three mornings, which is long enough for a transient
 * outage to pass and short enough that nobody has forgotten asking for it.
 */
export const GIVE_UP_AFTER = 3

/**
 * How long to wait before the one retry.
 *
 * Long enough for the transient thing to have passed, short enough that the
 * result is still the morning's. It holds the scheduler's claim on the ritual
 * while it waits, so the next tick cannot fire it underneath us.
 */
export const RETRY_DELAY_MS = 10 * 60_000

/**
 * Whether a failed run is worth one more attempt.
 *
 * Only `failed` — the run ended early or errored, which transient things cause.
 * Explicitly **not** `blocked`: that is a run refused a tool it needed, and
 * running it again produces the identical refusal, a minute later, for money.
 * What a blocked ritual needs is the narrow rule it asked for, which it already
 * offers you.
 *
 * And only when this is the first sign of trouble. Once a streak is under way
 * the retry has stopped being a second chance and become a way to fail twice
 * as often.
 */
export function shouldRetry(outcome: RitualOutcome, historyBefore: RitualHistory): boolean {
  return outcome === 'failed' && historyBefore.failingStreak === 0
}

export interface GiveUpVerdict {
  /** How to say it, on the row and in the notification. */
  reason: string
}

/**
 * Whether this ritual has failed often enough in a row to stop firing.
 *
 * `history` must include the run that has just finished — the streak is about
 * where things stand now, not where they stood before it.
 */
export function shouldGiveUp(history: RitualHistory): GiveUpVerdict | null {
  if (history.failingStreak < GIVE_UP_AFTER) return null

  const runs = history.failingStreak
  const since = history.lastOkAt
    ? ` It last worked on ${new Date(history.lastOkAt).toLocaleDateString()}.`
    : ' It has never produced a usable result.'

  return {
    reason: `Turned off after ${runs} runs in a row came to nothing.${since}`,
  }
}
