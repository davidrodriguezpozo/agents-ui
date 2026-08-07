import { findSession } from '../../../../utils/sessions'
import { devCommandFor, getPreview } from '../../../../utils/preview'

/** What is running for this session, and what would run if you asked. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const dev = await devCommandFor(session.repoDir)
  const running = getPreview(id)

  return {
    command: dev?.command ?? null,
    source: dev?.source ?? null,
    from: dev?.from ?? null,
    preview: running
      ? { state: running.state, port: running.port, command: running.command, output: running.output }
      : null,
  }
})
