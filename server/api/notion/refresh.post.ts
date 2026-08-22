import { refreshNotionIntake } from '../../utils/notionIntakeRefresh'
import { readPreferences } from '../../utils/preferences'
import { getProjectDir } from '../../utils/scope'

/**
 * Go and read Notion now, because a person asked.
 *
 * The Land band draws its Notion half out of a store, so this is the only thing
 * that ever fills it — there is no timer, deliberately. A refresh is a model run
 * taking tens of seconds and costing cents, and putting that on the band's
 * two-minute poll would bill somebody for leaving a tab open. See
 * `notionIntake.ts`.
 *
 * The work is in `refreshNotionIntake`; this handler's only job is turning a
 * refusal into a status code. Every refusal happens before anything is spent, and
 * says so.
 */
const STATUS: Record<string, number> = {
  not_configured: 400,
  no_project: 400,
  not_connected: 409,
}

export default defineEventHandler(async (event) => {
  const { notionIntake } = await readPreferences()

  const result = await refreshNotionIntake(notionIntake, getProjectDir(event) ?? undefined)

  if (!result.ok) {
    throw createError({
      statusCode: STATUS[result.refusal.error] ?? 400,
      data: result.refusal,
    })
  }

  return {
    checkedAt: result.state.checkedAt,
    costUsd: result.state.costUsd,
    durationMs: result.state.durationMs,
    error: result.state.error,
    count: result.state.tickets.length,
  }
})
