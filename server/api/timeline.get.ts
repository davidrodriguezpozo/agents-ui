import { listRuns } from '../utils/runStore'

/**
 * Every run in a window, for drawing rather than for reading.
 *
 * Distinct from `/api/runs` on purpose. That endpoint answers "the last fifty,
 * newest first", which is the right shape for a log and the wrong one for a
 * night: fifty runs might only reach lunchtime, and a timeline missing its
 * earliest hours draws an idle machine that was in fact busy. This one is bounded
 * by *time* and returns everything inside it.
 */

/** A night, which is the window the product's pitch is about. */
const DEFAULT_HOURS = 24

/** Past this it stops being a night and starts being the activity log. */
const MAX_HOURS = 72

/**
 * High enough that a real day never truncates, low enough to bound the response.
 * A truncated window would be worse than a shorter one, so the count is returned
 * and the client says so rather than quietly drawing a partial night.
 */
const MAX_RUNS = 1500

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const requested = Number(query.hours)
  const hours = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_HOURS)
    : DEFAULT_HOURS

  const to = Date.now()
  const from = to - hours * 3_600_000

  const runs = await listRuns({ since: from, limit: MAX_RUNS })

  return {
    from,
    to,
    hours,
    runs,
    /** True when the cap was hit, so the chart can say the night is incomplete. */
    truncated: runs.length >= MAX_RUNS,
  }
})
