import { refreshInboxSource } from '../../utils/inboxRefresh'
import { getProjectDir } from '../../utils/scope'

/**
 * Go and look now, because a person asked.
 *
 * The work is in `refreshInboxSource`, shared with the daily run so that
 * pressing the button and the clock reaching 08:00 cannot drift apart. This
 * handler's only job is turning a refusal into a status code.
 */
const STATUS: Record<string, number> = {
  unknown_source: 400,
  no_project: 400,
  source_unavailable: 409,
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ source?: string }>(event).catch(() => ({} as { source?: string }))
  const result = await refreshInboxSource(
    String(body?.source ?? ''),
    getProjectDir(event) ?? undefined,
  )

  if (!result.ok) {
    throw createError({
      statusCode: STATUS[result.refusal.error] ?? 400,
      data: result.refusal,
    })
  }

  return result.state
})
