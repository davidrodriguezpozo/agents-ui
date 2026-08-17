import { commandsLeftToday, commandsRefusal, readDelivery } from '../../utils/digestDelivery'

/**
 * Where the morning report is sent, how the last attempt went, and whether
 * replies to it are being read.
 *
 * A file read, so the settings page costs nothing to open. Everything expensive
 * about this feature is in `send.post.ts` and `commands.post.ts`.
 *
 * `commandsRefusal` is computed here rather than in the page. It is the security
 * argument for the whole return leg — which destinations may command this machine
 * and why — and a second copy of that reasoning in a Vue component is a second
 * copy that can disagree with the one that actually decides.
 */
export default defineEventHandler(async () => {
  const delivery = await readDelivery()

  return {
    ...delivery,
    commandsRefusal: commandsRefusal(delivery),
    commandsLeftToday: commandsLeftToday(delivery, Date.now()),
  }
})
