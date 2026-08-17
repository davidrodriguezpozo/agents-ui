import { parseTimeOfDay } from '../../utils/inbox'
import { deliveryStore, DEFAULT_DELIVERY } from '../../utils/digestDelivery'

/**
 * Change where it goes, when it goes, or whether it goes at all.
 *
 * Two refusals, both about not storing a setting that looks armed and never
 * fires: a time that is not a time, and an empty destination. Turning it *off*
 * is always allowed, whatever state anything else is in — a switch that can be
 * refused is a switch nobody trusts.
 *
 * Changing the destination clears the resolved channel id on purpose. The id is
 * what stops the destination drifting between sends, so it has to be re-derived
 * the moment the words behind it change — and re-deriving costs a hand-pressed
 * send, which is also the last chance to notice the report is about to go
 * somewhere new.
 */
export default defineEventHandler(async (event) => {
  interface Patch {
    enabled?: boolean
    at?: string | null
    destination?: string
  }

  const body = await readBody<Patch>(event).catch(() => ({} as Patch))

  if (body?.at != null && body.at !== '' && !parseTimeOfDay(body.at)) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'bad_time',
        message: `"${body.at}" is not a time of day. Use HH:MM, like 08:15.`,
      },
    })
  }

  const destination = body?.destination === undefined ? undefined : String(body.destination).trim()

  if (destination !== undefined && !destination) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'no_destination',
        message: 'Say where it should go — a channel like #daily-brief, or a direct message '
          + 'to yourself. There is no default worth guessing at here.',
      },
    })
  }

  return deliveryStore.update((state) => {
    if (body?.enabled !== undefined) state.enabled = body.enabled === true
    if (body?.at !== undefined) state.at = body.at == null || body.at === '' ? undefined : String(body.at)

    if (destination !== undefined && destination !== state.destination) {
      state.destination = destination
      // See the note above: a new description must not inherit the old id.
      state.channelId = undefined
      state.channelLabel = undefined
    }

    // A change is the moment the previous complaint stops being about now.
    if (body?.destination !== undefined || body?.at !== undefined) state.lastError = undefined

    return { ...DEFAULT_DELIVERY, ...state }
  })
})
