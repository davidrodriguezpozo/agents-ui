import { createSnapshot } from '../../utils/snapshots'

/** Take a snapshot now, rather than waiting for the timer. */
export default defineEventHandler(async () => {
  try {
    return await createSnapshot('manual')
  } catch (e) {
    throw createError({
      statusCode: 500,
      data: {
        error: 'snapshot_failed',
        message: `Could not take a snapshot: ${(e as Error).message}`,
      },
    })
  }
})
