import { findSession } from '../../../../utils/sessions'
import { devCommandFor, startPreview, stopPreview } from '../../../../utils/preview'

/**
 * Start or stop this session's dev server.
 *
 * State-changing — it runs a command from the project — so the same-origin
 * check in front of every request applies.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const body = await readBody<{ stop?: boolean }>(event)

  if (body?.stop) {
    stopPreview(id)
    return { stopped: true }
  }

  const dev = await devCommandFor(session.repoDir)
  if (!dev) {
    throw createError({
      statusCode: 400,
      message: 'This project has no dev command set. Add one in Settings.',
    })
  }

  const preview = await startPreview(id, session.worktreePath, dev.command)
  return {
    state: preview.state,
    port: preview.port,
    command: preview.command,
    pickerPort: preview.pickerPort,
  }
})
