import { readCommands } from '../../utils/digestCommands'

/**
 * Read replies to the report now, because a person asked.
 *
 * The work is in `readCommands`, shared with the poll so that pressing the button
 * and the two-minute tick cannot drift apart.
 *
 * Worth having as a button rather than only as a background job for one reason:
 * the first time anybody turns this on, they want to see what a reply does while
 * they are watching it — not discover it two minutes later, from a notification,
 * having already started something.
 */
const STATUS: Record<string, number> = {
  not_configured: 409,
  no_budget: 429,
}

export default defineEventHandler(async () => {
  const outcome = await readCommands()

  if (!outcome.ok) {
    throw createError({
      statusCode: STATUS[outcome.refusal.error] ?? 400,
      data: outcome.refusal,
    })
  }

  return outcome
})
