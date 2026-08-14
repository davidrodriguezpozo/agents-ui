import { findInboxSource, inboxStore, parseTimeOfDay } from '../../utils/inbox'

/**
 * Turn the daily look on, or off.
 *
 * Two refusals, and both are about not creating a job that silently never works:
 *
 *   - a time that is not a time, because "23:70" stored is a schedule that looks
 *     set and never fires;
 *   - a source that has never run by hand, because the project directory to ask
 *     from is recorded by that run, and MCP reachability is decided by it.
 *
 * The second one is the useful one. It means the only thing you can automate is
 * something you have already watched work.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ source?: string; at?: string | null }>(event)
    .catch(() => ({} as { source?: string; at?: string | null }))

  const source = findInboxSource(String(body?.source ?? ''))
  if (!source) {
    throw createError({
      statusCode: 400,
      data: { error: 'unknown_source', message: 'There is no inbox source by that name.' },
    })
  }

  // Null or empty turns it off, which must always be allowed — including for a
  // source that is currently failing.
  const wanted = body?.at == null || body.at === '' ? null : String(body.at)

  if (wanted !== null && !parseTimeOfDay(wanted)) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'bad_time',
        message: `"${wanted}" is not a time of day. Use HH:MM, like 08:00.`,
      },
    })
  }

  const state = await inboxStore.update((inbox) => {
    const existing = inbox.sources.find(s => s.source === source.key)

    if (wanted === null) {
      if (existing) existing.refreshAt = undefined
      return existing ?? { source: source.key, items: [] }
    }

    if (!existing?.projectDir) {
      throw createError({
        statusCode: 409,
        data: {
          error: 'never_run',
          message: `Refresh ${source.label} by hand once first. A daily run needs to `
            + 'know which project to ask from, and that is what the first refresh records.',
        },
      })
    }

    existing.refreshAt = wanted
    return existing
  })

  return state
})
