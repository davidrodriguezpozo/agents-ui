import type { StudioNotification } from './types'

/**
 * Being told, rather than looking.
 *
 * The server already has the pipe: `/api/notifications/stream` carries the same
 * `needsYou` / `failed` / `finished` events the browser tab gets, in the same
 * `data: {json}` shape this client already reads, and replays the last couple
 * of minutes to anything that reconnects. Subscribing to it is what turns the
 * terminal app from a thing you watch into a thing that tells you — and it is
 * also the honest fix for polling: a nudge on the stream refreshes the pane
 * immediately, so the timers underneath can be as slow as they like.
 *
 * There is no push service and nothing stored about the client; a notification
 * exists only while something is listening. Quitting stops them, which is the
 * behaviour you would expect of a program you have closed.
 */

/** How long to wait before trying the stream again, per consecutive failure. */
function backoff(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** attempt)
}

export interface WatchOptions {
  signal: AbortSignal
  onNotification: (notification: StudioNotification) => void
  sleep?: (ms: number) => Promise<void>
}

export interface NotificationSource {
  events: (
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined>; signal?: AbortSignal },
  ) => AsyncGenerator<Record<string, unknown>>
}

/**
 * Follow the notification stream until told to stop.
 *
 * The cursor is the last id seen, which is exactly what the endpoint's
 * `?after=` wants — a reconnect after a sleeping laptop catches up rather than
 * losing whatever arrived meanwhile.
 */
export async function watchNotifications(
  source: NotificationSource,
  options: WatchOptions,
): Promise<void> {
  const { signal, onNotification, sleep = ms => new Promise(r => setTimeout(r, ms)) } = options
  let after: string | undefined
  let attempt = 0

  while (!signal.aborted) {
    try {
      for await (const frame of source.events('/api/notifications/stream', {
        query: { after },
        signal,
      })) {
        attempt = 0
        const notification = asNotification(frame)
        if (!notification) continue
        after = notification.id
        onNotification(notification)
      }
    } catch {
      // The server going away is a reconnect, not a failure worth a banner:
      // there is already one place that says the server is gone, and it is the
      // poll that the pane on screen depends on.
    }

    if (signal.aborted) break
    await sleep(backoff(attempt++))
  }
}

/** A frame off the wire, if it is one of ours. */
export function asNotification(frame: Record<string, unknown>): StudioNotification | null {
  const kind = frame.kind
  if (kind !== 'needsYou' && kind !== 'failed' && kind !== 'finished') return null
  if (typeof frame.id !== 'string' || typeof frame.title !== 'string') return null

  return {
    id: frame.id,
    kind,
    title: frame.title,
    body: typeof frame.body === 'string' ? frame.body : '',
    link: typeof frame.link === 'string' ? frame.link : '/',
    at: typeof frame.at === 'number' ? frame.at : Date.now(),
  }
}

/**
 * What to write to the terminal for a notification.
 *
 * `\x07` is the bell, which is the one thing every terminal since 1970 agrees
 * on: whether it beeps, flashes, or marks the tab is the terminal's business
 * and the user's setting, which is the right place for that decision. OSC 9 on
 * top of it asks for a real desktop banner — iTerm2, WezTerm and Windows
 * Terminal understand it, and the terminals that do not ignore an unknown OSC
 * rather than printing it.
 *
 * Only for the one kind that means a person is needed. A bell for every
 * finished run is a bell you turn off, and then the one that mattered is off
 * too.
 */
export function alertFor(notification: StudioNotification): string {
  if (notification.kind !== 'needsYou') return ''
  const text = `${notification.title}${notification.body ? ` — ${notification.body}` : ''}`
  return `\x07\x1b]9;${text.replace(/[\x00-\x1f\x7f]/g, ' ')}\x07`
}

/** One line, for `agents-studio watch`. */
export function notificationLine(notification: StudioNotification): string {
  const time = new Date(notification.at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const mark = notification.kind === 'needsYou' ? '●' : notification.kind === 'failed' ? '✕' : '✓'
  return [time, mark, notification.title, notification.body].filter(Boolean).join('  ')
}
