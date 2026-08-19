/**
 * The two decisions behind a browser notification, kept out of the composable
 * so they can be tested without a Notification API to stub.
 */

export interface StudioNotification {
  id: string
  kind: 'needsYou' | 'failed' | 'finished'
  title: string
  body: string
  /** A path within this app, resolved against the tab's own origin. */
  link: string
  at: number
}

/** What a tab knows about itself at the moment one arrives. */
export interface TabState {
  /** `document.visibilityState === 'visible'` — not the same as focused. */
  visible: boolean
  /** Whether this window is the one being typed into. */
  focused: boolean
  /** The route currently shown, path only. */
  path: string
}

/**
 * Whether this arrival is worth a banner.
 *
 * Two are dropped, and only two. The first is the obvious one: a banner about
 * the page you are looking at, in the window you are looking at it in, is a
 * notification telling you something you can already see. The session page
 * updates itself — the run appearing in it *is* the notification.
 *
 * The second is a replay of something already shown. A reconnecting tab asks
 * for the last two minutes so a dropped connection loses nothing, and the cost
 * of that is the occasional repeat, which the caller's `seen` set absorbs.
 *
 * Everything else shows, including a visible tab on some other page — "visible"
 * covers a window sitting untouched on a second monitor, which is exactly the
 * case a notification is for.
 */
export function shouldNotify(entry: StudioNotification, tab: TabState, seen: Set<string>): boolean {
  if (seen.has(entry.id)) return false

  const looking = tab.visible && tab.focused && samePath(tab.path, entry.link)
  return !looking
}

/** Query strings and hashes are not what a notification is about. */
function samePath(a: string, b: string): boolean {
  const strip = (value: string) => (value.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  return strip(a) === strip(b)
}

/**
 * How the banner is drawn.
 *
 * `tag` is the id, so the same notification arriving in four open tabs is one
 * banner rather than four — the browser replaces a notification that shares a
 * tag instead of stacking it. `renotify` is deliberately off for the same
 * reason: the replacement should be silent.
 *
 * `requireInteraction` for the one kind that is genuinely blocked on you: a
 * run waiting for a permission stays waiting, and a banner that faded after
 * four seconds while you were making coffee is the failure this whole feature
 * exists to prevent. The other two are reports, and reports can fade.
 */
export function notificationOptions(entry: StudioNotification): NotificationOptions {
  return {
    body: entry.body,
    tag: entry.id,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    timestamp: entry.at,
    requireInteraction: entry.kind === 'needsYou',
    data: { link: entry.link, kind: entry.kind },
  } as NotificationOptions
}
