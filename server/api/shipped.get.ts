import { readSessions } from '../utils/sessions'
import { buildShipped, describeShipped } from '../utils/shipped'

/**
 * What shipped, for somebody who has never opened this app.
 *
 * Read-only and deliberately narrow: it hands back sentences, names, repositories
 * and a verdict, and nothing an action could be taken with. The session id rides
 * along so a link can exist for whoever wants the technical half, which is one
 * press away on the session's own page rather than on this one.
 */
export default defineEventHandler(async (event) => {
  const days = Math.max(1, Math.min(Number(getQuery(event).days) || 14, 90))
  const board = buildShipped(await readSessions().catch(() => []), { now: Date.now(), days })

  return { ...board, summary: describeShipped(board) }
})
