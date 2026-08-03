import { restoreSnapshot } from '../../utils/snapshots'

/**
 * Roll sessions and rituals back to a snapshot.
 *
 * The current state is snapshotted first, so choosing the wrong one is
 * recoverable — the response says which snapshot that was.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: string }>(event)
  const name = body?.name?.trim()

  if (!name) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_snapshot', message: 'Which snapshot should be restored?' },
    })
  }

  // The name goes straight into a path, so it must not be able to leave the
  // snapshots directory.
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw createError({
      statusCode: 400,
      data: { error: 'bad_name', message: 'That is not a valid snapshot name.' },
    })
  }

  return restoreSnapshot(name)
})
