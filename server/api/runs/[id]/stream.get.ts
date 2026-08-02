import { getActive, readRun, releaseIfIdle, type RunEvent } from '../../../utils/runStore'

/**
 * Attach to a run. Replays everything that already happened (from `?after=`),
 * then follows live until the run finishes. Reconnecting mid-run — or opening
 * a finished run hours later — both work through this one endpoint.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const after = Number(getQuery(event).after ?? -1)

  const run = await readRun(id)
  if (!run) {
    throw createError({ statusCode: 404, message: `Run not found: ${id}` })
  }

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const write = (payload: unknown) => {
    event.node.res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  // Catch the client up on everything it hasn't seen.
  for (const past of run.events) {
    if (past.seq > after) write(past)
  }

  const entry = getActive(id)
  const finished = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'

  if (!entry || finished) {
    write({ type: 'done', status: run.status, id })
    event.node.res.end()
    return
  }

  // Follow live.
  await new Promise<void>((resolve) => {
    const onEvent = (e: RunEvent) => {
      write(e)
      if (e.type === 'status' && ['completed', 'failed', 'cancelled'].includes(String(e.status))) {
        cleanup()
        write({ type: 'done', status: e.status, id })
        resolve()
      }
    }

    const onClose = () => {
      cleanup()
      resolve()
    }

    function cleanup() {
      entry!.emitter.off('event', onEvent)
      event.node.req.off('close', onClose)
    }

    entry.emitter.on('event', onEvent)
    event.node.req.on('close', onClose)
  })

  event.node.res.end()
  releaseIfIdle(id)
})
