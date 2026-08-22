import { readSchedules, shareRitual, unshareRitual } from '../../../utils/schedules'

/**
 * Hand a ritual to the repository, or take it back.
 *
 * The definition is written into the project's shared file, where it lands in
 * somebody's diff — see `shareRitual` for what is deliberately left behind
 * (trust, run history, whether it is on). Taking it back keeps the row on this
 * machine, because "stop sharing" is not "delete".
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'A ritual id is required' })

  const body = await readBody<{ stop?: boolean }>(event).catch(() => ({} as { stop?: boolean }))

  if (body?.stop) {
    const stopped = await unshareRitual(id)
    if (!stopped) {
      throw createError({ statusCode: 400, message: 'That ritual is not shared by this repository.' })
    }
  } else {
    const shared = await shareRitual(id)
    if (!shared) {
      throw createError({
        statusCode: 400,
        data: {
          error: 'no_project',
          message: 'A ritual has to belong to a repository before it can be shared through one.',
        },
      })
    }
  }

  const schedule = (await readSchedules()).find(s => s.id === id)
  return { id, shared: Boolean(schedule?.sharedKey), key: schedule?.sharedKey ?? null }
})
