import { getTerminal, startTerminal } from '../../utils/terminal'
import { resolveWorkTerminal } from '../../utils/workTerminal'

/**
 * Attach to the selected project's shell.
 *
 * The same shape as the session stream next door: start one if there is none
 * running, replay the scrollback so a reconnect redraws rather than opening on
 * a blank screen, then follow live. Closing the tab detaches and leaves the
 * shell running — a build should survive navigating away, and the reaper in
 * `plugins/terminals.ts` closes one nobody has watched for half an hour.
 *
 * The project arrives as a query parameter rather than the usual header
 * because `EventSource` cannot set one.
 */
export default defineEventHandler(async (event) => {
  const { id, cwd } = await resolveWorkTerminal(event)

  const running = getTerminal(id)
  const terminal = running && running.exited === undefined ? running : startTerminal(id, cwd)

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
