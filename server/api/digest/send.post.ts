import { sendDigest } from '../../utils/digestSend'
import { getProjectDir } from '../../utils/scope'

/**
 * Send it now, because a person asked.
 *
 * The work is in `sendDigest`, shared with the daily send so that pressing the
 * button and the clock reaching 08:15 cannot drift apart. This handler turns a
 * refusal into a status code and nothing else.
 *
 * `force` is on by default here, and that is the difference between the two
 * callers. The schedule stays quiet on a morning where nothing happened; somebody
 * who pressed a button is owed a message either way, because silence in answer to
 * a press is indistinguishable from a feature that does not work.
 *
 * This is also the only way the destination ever gets resolved — which makes the
 * first press the moment you find out where the report is going, while you are
 * sitting there watching it. That is deliberate: the schedule cannot start until
 * this has worked once.
 */
const STATUS: Record<string, number> = {
  no_project: 400,
  slack_unavailable: 409,
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ force?: boolean }>(event).catch(() => ({} as { force?: boolean }))

  const result = await sendDigest({
    projectDir: getProjectDir(event) ?? undefined,
    force: body?.force !== false,
  })

  if (!result.ok) {
    throw createError({
      statusCode: STATUS[result.refusal.error] ?? 400,
      data: result.refusal,
    })
  }

  return result
})
