import {
  recentBrowserNotifications,
  replayableNotifications,
  subscribeBrowserNotifications,
  type BrowserNotification,
} from '../../utils/notifyBus'

/**
 * The tab's end of the notification pipe.
 *
 * Held open for as long as the page is, which is the whole design: there is no
 * push service, no VAPID key and nothing stored about the browser — a
 * notification exists only while something is there to receive it, and the
 * moment the tab closes this connection closes with it.
 *
 * `id:` lines are what make a reconnect cheap. EventSource remembers the last
 * one it saw and sends it back as `Last-Event-ID`, so a connection dropped by a
 * sleeping laptop resumes rather than losing whatever arrived meanwhile — see
 * `replayableNotifications` for the two minutes that are worth catching up on.
 */
export default defineEventHandler(async (event) => {
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    // Nothing in front of this by default, but a reverse proxy that buffers
    // would hold every banner until the connection ends, which is never.
    'X-Accel-Buffering': 'no',
  })

  const write = (entry: BrowserNotification) => {
    event.node.res.write(`id: ${entry.id}\ndata: ${JSON.stringify(entry)}\n\n`)
  }

  // A comment line is ignored by EventSource and is the standard way to say
  // "still here" — to us, and to anything in between with an idle timeout.
  event.node.res.write(': open\n\n')

  const cursor = getHeader(event, 'last-event-id') ?? (getQuery(event).after as string | undefined)
  for (const missed of replayableNotifications(recentBrowserNotifications(), cursor, Date.now())) write(missed)

  await new Promise<void>((resolve) => {
    const unsubscribe = subscribeBrowserNotifications(write)
    const heartbeat = setInterval(() => event.node.res.write(': ping\n\n'), 25_000)

    const onClose = () => {
      clearInterval(heartbeat)
      unsubscribe()
      event.node.req.off('close', onClose)
      resolve()
    }

    event.node.req.on('close', onClose)
  })

  event.node.res.end()
})
