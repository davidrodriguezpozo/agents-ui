import { findSession } from '../../../../utils/sessions'
import { resizeTerminal, sendInput, stopTerminal } from '../../../../utils/terminal'

/**
 * Everything that goes *into* a session's shell: keystrokes, a new size, or a
 * request to close it. Output comes back over the stream.
 *
 * State-changing, so the same-origin check in front of every request applies —
 * a page you happen to have open cannot type into your shell.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const body = await readBody<{
    input?: string
    cols?: number
    rows?: number
    close?: boolean
  }>(event)

  if (body?.close) {
    stopTerminal(id)
    return { closed: true }
  }

  if (typeof body?.cols === 'number' && typeof body?.rows === 'number') {
    return { resized: resizeTerminal(id, body.cols, body.rows) }
  }

  if (typeof body?.input === 'string') {
    return { sent: sendInput(id, body.input) }
  }

  throw createError({ statusCode: 400, message: 'Nothing to do: send input, a size, or close.' })
})
