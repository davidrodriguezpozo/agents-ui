import { findSession } from '../../../../utils/sessions'
import { getTerminal, startTerminal } from '../../../../utils/terminal'

/**
 * Attach to this session's shell.
 *
 * Starts one if there is not already one running, replays the scrollback so a
 * reconnect redraws rather than opening on a blank screen, then follows live.
 * Closing the tab detaches; the shell keeps running, which is the point — a
 * long build should not die because somebody navigated away.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const terminal = getTerminal(id)?.exited === undefined
    ? getTerminal(id) ?? startTerminal(id, session.worktreePath)
    : startTerminal(id, session.worktreePath)

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const write = (payload: unknown) => {
    event.node.res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  // Redraw whatever is already on the screen before following along.
  if (terminal.scrollback) write({ type: 'data', data: terminal.scrollback })

  terminal.attached++

  await new Promise<void>((resolve) => {
    const onData = (data: string) => write({ type: 'data', data })
    const onExit = (code: number) => {
      write({ type: 'exit', code })
      cleanup()
      resolve()
    }
    const onClose = () => {
      cleanup()
      resolve()
    }

    function cleanup() {
      terminal.attached = Math.max(0, terminal.attached - 1)
      terminal.emitter.off('data', onData)
      terminal.emitter.off('exit', onExit)
      event.node.req.off('close', onClose)
    }

    terminal.emitter.on('data', onData)
    terminal.emitter.on('exit', onExit)
    event.node.req.on('close', onClose)
  })

  event.node.res.end()
})
