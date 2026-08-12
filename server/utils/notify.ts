import { execFile } from 'node:child_process'
import { platform } from 'node:os'
import { postViaNotifier } from './notifier'
import { readPreferences } from './preferences'

/**
 * Telling you something happened while you were not looking.
 *
 * This is the other half of running as a service. Work that proceeds without
 * you is only useful if it can reach you when it stops being able to — a
 * ritual blocked on a permission at 08:00 is worth exactly nothing if the
 * first you hear of it is at 11:00.
 *
 * The notification goes to the operating system rather than the browser on
 * purpose: the browser is usually shut, which is the case this exists for.
 *
 * A banner is also a thing you click, and clicking it should land you on the
 * session or run it is about — see `notifier.ts` for the small app bundle that
 * makes that possible.
 */

export type NotifyKind = 'needsYou' | 'failed' | 'finished'

/**
 * AppleScript has no parameter binding — the text is part of the program. A
 * title containing a quote would end the string and the rest would be run as
 * code, so both escapable characters are escaped and newlines are flattened.
 * (`execFile` keeps a shell out of it; this covers the layer below that.)
 */
export function appleScriptString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')
}

/**
 * Long output makes an unreadable banner, so say the first useful thing.
 *
 * Named for the banner rather than called `summarize`: server utils are
 * auto-imported into one namespace, and a generic name here quietly shadows
 * the conversation summariser in `history.ts`.
 */
export function bannerText(text: string, limit = 120): string {
  const flat = text.replace(/[\s#*`>_-]+/g, ' ').trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit - 1).trimEnd()}…`
}

/**
 * Where a banner should take you, as this server's own address.
 *
 * The browser is on the same machine — that is the only place this app is ever
 * reachable from by default — so the loopback address is the right one, and the
 * port has to come from the environment the service was started with rather
 * than a guess at 3000.
 *
 * A host bound to every interface, or an IPv6 literal, is not an address a
 * browser can be sent to as-is; loopback is, and it reaches the same server.
 */
export function studioUrl(path = '/'): string {
  const port = Number(process.env.PORT) || 3000
  const host = process.env.HOST
  const reachable = host && host !== '0.0.0.0' && !host.includes(':') ? host : '127.0.0.1'

  return `http://${reachable}:${port}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * The page that answers a banner about a run.
 *
 * A turn belongs to a session and is read there, in the conversation it is part
 * of; anything else — a ritual firing, a workflow step — has only its own run
 * page, which is where its transcript is.
 */
export function runPath(run: { id: string; sessionId?: string }): string {
  return run.sessionId ? `/sessions/${run.sessionId}` : `/runs/${run.id}`
}

async function send(title: string, body: string, link: string): Promise<void> {
  const os = platform()

  if (os === 'darwin') {
    try {
      await postViaNotifier(title, body, link)
      return
    } catch {
      // No bundle, so no icon of our own and nowhere for a click to go. Still
      // worth saying — the fallback is what this always used to do.
    }

    const script = `display notification "${appleScriptString(body)}" with title "${appleScriptString(title)}"`
    execFile('osascript', ['-e', script], () => {})
    return
  }

  if (os === 'linux') {
    execFile('notify-send', ['--app-name=Agent Manager', title, body], () => {})
  }

  // Anywhere else, staying silent is the whole behaviour.
}

/**
 * Best-effort by design: a run must never fail, stall or log noise because the
 * desktop could not show a banner.
 *
 * `link` is a path within this app — `/sessions/abc` — and is where clicking the
 * banner goes. Left out, a click opens the app on its landing page, which is
 * still an answer to "what was that about".
 */
export async function notify(kind: NotifyKind, title: string, body: string, link = '/'): Promise<void> {
  try {
    const { notifications } = await readPreferences()
    if (!notifications.enabled || !notifications[kind]) return

    await send(title, bannerText(body), studioUrl(link))
  } catch {
    // Deliberately swallowed.
  }
}
