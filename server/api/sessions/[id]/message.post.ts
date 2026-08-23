import { findSession } from '../../../utils/sessions'
import { sendOrQueue } from '../../../utils/sessionTurn'
import { sanitiseAttachments } from '~/utils/imageAttachments'

/**
 * Send a turn to a session, or queue it behind the one still running.
 *
 * Each turn is a fresh detached run pointed at the session's worktree and
 * resumed onto its SDK session, which is how continuity works — the SDK has no
 * long-lived handle of its own. Everything the run subsystem already does
 * (streaming, replay, permissions, persistence) applies unchanged.
 *
 * A session already working keeps the message instead of refusing it, and sends
 * it the moment the turn ends. The reply says which of the two happened, so the
 * page can attach to a run or draw a waiting message without guessing.
 *
 * Images may come with it. They reach the CLI as blocks on the turn's opening
 * message rather than as files it is told to read — see `liveSteer` — which is
 * both what the model wants and the only version that does not need the Read
 * tool to be allowed wherever the screenshot happened to be saved.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ input?: string; attachments?: unknown }>(event)

  // The same rules the browser already applied, applied again: this endpoint is
  // reachable by anything and what it forwards ends up in a paid API call.
  const images = sanitiseAttachments(body?.attachments)

  // An image with nothing typed under it is a whole instruction — "look at
  // this" is what dropping it in said — so text is only required alone.
  if (!body?.input?.trim() && !images.length) {
    throw createError({ statusCode: 400, message: 'input is required' })
  }

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const result = await sendOrQueue(session, body.input ?? '', images)

  return { ...result, sessionId: session.id }
})
