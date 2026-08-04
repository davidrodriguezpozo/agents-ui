import { allowedHostsFromEnv, checkOrigin } from '../utils/sameOrigin'

/**
 * Refuse anything that did not come from this app.
 *
 * Runs before every request, including the pages, because a rebinding attack
 * wants the HTML as much as the API. See `utils/sameOrigin.ts` for what is
 * being defended against and why two signals are needed rather than one.
 */
export default defineEventHandler((event) => {
  const verdict = checkOrigin(
    {
      method: event.method,
      origin: getHeader(event, 'origin'),
      secFetchSite: getHeader(event, 'sec-fetch-site'),
      host: getHeader(event, 'host'),
    },
    allowedHostsFromEnv(process.env.AGENTS_STUDIO_ALLOWED_HOSTS),
  )

  if (verdict.allowed) return

  // 403 rather than 404: this is a refusal, and someone hitting it through a
  // proxy they set up themselves needs to be told which knob to turn.
  throw createError({
    statusCode: 403,
    data: { error: 'not_this_app', message: verdict.reason },
  })
})
