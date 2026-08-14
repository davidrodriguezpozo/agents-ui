import { setRunsHidden } from '../../utils/runStore'

/**
 * Take rows off the Work list, or put them back.
 *
 * One endpoint for one row and for a hundred, because clearing a cluttered list
 * is the same act as clearing one line of it and splitting them would only mean
 * two places to keep in step.
 *
 * It does not delete anything, and that is the point rather than a limitation.
 * Runs are what `failingStreak`, the spend total and the night-shift figures are
 * computed from, so deleting a failed ritual run would reset the streak and make
 * a broken ritual look healthy. Tidying a list must never be a way to silence the
 * warning the app exists to give.
 */
const MAX_IDS = 500

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: unknown; hidden?: unknown }>(event)
    .catch(() => ({} as { ids?: unknown; hidden?: unknown }))

  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  if (!ids.length) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_ids', message: 'Nothing was named to remove.' },
    })
  }

  if (ids.length > MAX_IDS) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'too_many',
        message: `That is more than ${MAX_IDS} at once. Narrow the filters and clear in batches.`,
      },
    })
  }

  // Restoring is the same call with `hidden: false`, so the default has to be
  // the destructive-looking one only because it is the common one — and it is
  // not actually destructive.
  const hidden = body?.hidden !== false

  return await setRunsHidden(ids, hidden)
})
