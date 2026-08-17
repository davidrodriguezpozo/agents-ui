import { readDelivery } from '../../utils/digestDelivery'

/**
 * Where the morning report is sent, and how the last attempt went.
 *
 * A file read, so the settings page costs nothing to open. Everything expensive
 * about this feature is in `send.post.ts`.
 */
export default defineEventHandler(async () => {
  return readDelivery()
})
