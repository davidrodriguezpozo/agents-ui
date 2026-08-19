import { resizeTerminal, sendInput, stopTerminal } from '../../utils/terminal'
import { resolveWorkTerminal } from '../../utils/workTerminal'

/**
 * Everything that goes *into* the project's shell: keystrokes, a new size, or a
 * request to close it. Output comes back over the stream.
 *
 * State-changing, so the same-origin check in front of every request applies —
 * a page you happen to have open cannot type into your shell.
 */
export default defineEventHandler(async (event) => {
  const { id } = await resolveWorkTerminal(event)

  const body = await readBody<{
    input?: string | string[]
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

  /**
   * An array as well as a string, because the pane coalesces keystrokes.
   *
   * Joined rather than written one at a time: each `sendInput` is a separate
   * write to the pty, and splitting a pasted line across writes is how an
   * escape sequence gets torn in half.
   */
  const input = Array.isArray(body?.input)
    ? body.input.every(part => typeof part === 'string') ? body.input.join('') : null
    : typeof body?.input === 'string' ? body.input : null

  if (input !== null) {
    return { sent: sendInput(id, input) }
  }

  throw createError({ statusCode: 400, message: 'Nothing to do: send input, a size, or close.' })
})
