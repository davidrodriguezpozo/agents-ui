import { notificationOptions, shouldNotify, type StudioNotification } from '~/utils/browserNotifications'

/**
 * Banners posted by the browser you are already sitting in front of.
 *
 * The desktop notification this replaces had one real flaw and it was the
 * important one: a click could not reliably bring you back here. It belongs to
 * an application, ours is a half-second AppleScript applet, and the best it can
 * do is shell out to `open` — which lands in whichever browser the machine
 * prefers, on a second copy of a page you already had open.
 *
 * A notification the page posts itself has the tab. Clicking it focuses the
 * window you were already using and routes it, without a reload, to the session
 * that needs you. The price is that a shut browser posts nothing, which is a
 * real cost and is why the desktop banner is still one setting away.
 *
 * Three pieces:
 *
 *   permission — the browser's, asked for once, from a click. Chrome ignores a
 *   request that did not come from a gesture, so this is never asked on load.
 *
 *   the stream — `/api/notifications/stream`, held open for as long as the tab
 *   is. EventSource reconnects on its own and resumes from the last id it saw.
 *
 *   the worker — `public/sw.js`, which is what makes the click survive the tab
 *   being closed and posts back here to route rather than reload.
 */

export type NotificationSupport = 'ready' | 'insecure' | 'unsupported'

/**
 * One stream per tab, not one per caller.
 *
 * Module scope rather than inside the composable on purpose: the settings page
 * and the plugin that starts this both call it, and a connection held per
 * caller would mean two of everything — two EventSources on the server, and the
 * same banner drawn twice.
 */
let source: EventSource | null = null
let registration: ServiceWorkerRegistration | null = null

/** Every id this tab has drawn, so a replayed catch-up shows nothing twice. */
const seen = new Set<string>()

/** Long enough to cover any replay window, short enough to never be a leak. */
const SEEN_LIMIT = 200

/**
 * Where a click answered by the worker is sent. Held here rather than closed
 * over by the listener so that the listener can be attached exactly once, and
 * still route through whichever router is current.
 */
let navigate: ((link: string) => void) | null = null
let listening = false

export function useBrowserNotifications() {
  const permission = useState<NotificationPermission>('browser-notification-permission', () => 'default')
  const support = useState<NotificationSupport>('browser-notification-support', () => 'unsupported')
  const connected = useState('browser-notification-connected', () => false)
  const router = useRouter()

  function detect(): NotificationSupport {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
    // Reached over the network by IP rather than on localhost, `Notification`
    // exists and permission can never be granted. Worth saying plainly instead
    // of leaving a button that does nothing.
    if (!window.isSecureContext) return 'insecure'
    return 'ready'
  }

  function refresh() {
    support.value = detect()
    permission.value = support.value === 'ready' ? Notification.permission : 'denied'
  }

  /**
   * Ask, from a click.
   *
   * Also starts the stream on success: the point of granting permission is to
   * start being told things, and making that wait for a reload is the kind of
   * small failure that reads as the feature being broken.
   */
  async function request(): Promise<NotificationPermission> {
    refresh()
    if (support.value !== 'ready') return permission.value

    try {
      permission.value = await Notification.requestPermission()
    } catch {
      // Older Safari resolves this through a callback and rejects the promise
      // form; nothing to do but leave the stored value alone.
    }

    if (permission.value === 'granted') await start()
    return permission.value
  }

  /**
   * The worker, if the browser will have one.
   *
   * Not fatal if it will not: a notification posted directly still shows, and
   * still routes on click — it just dies with the tab, which for a banner shown
   * while you are looking at the tab is no loss at all.
   */
  async function ensureWorker(): Promise<ServiceWorkerRegistration | null> {
    if (registration) return registration
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null

    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      return registration
    } catch {
      return null
    }
  }

  function show(entry: StudioNotification) {
    const tab = {
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
      path: router.currentRoute.value.fullPath,
    }

    if (!shouldNotify(entry, tab, seen)) return

    seen.add(entry.id)
    // Insertion-ordered, so the oldest is the first key.
    while (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string)

    const options = notificationOptions(entry)

    if (registration) {
      // Through the worker where possible: that banner outlives the tab, and
      // its click arrives in `sw.js` rather than in a page that has since gone.
      void registration.showNotification(entry.title, options).catch(() => post(entry, options))
      return
    }

    post(entry, options)
  }

  /** The fallback: a notification owned by this page, routed by this page. */
  function post(entry: StudioNotification, options: NotificationOptions) {
    try {
      const notification = new Notification(entry.title, options)
      notification.onclick = () => {
        window.focus()
        void router.push(entry.link)
        notification.close()
      }
    } catch {
      // A browser that refuses to post one is not a reason to stop listening.
    }
  }

  async function start() {
    refresh()
    if (support.value !== 'ready' || permission.value !== 'granted' || source) return

    await ensureWorker()

    // A click answered in `sw.js` comes back here, as a route rather than a
    // reload. Attached once per tab; `navigate` is what keeps it current.
    navigate = link => void router.push(link)
    if (!listening && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { type?: string; link?: string } | null
        if (data?.type !== 'agents-studio:navigate' || !data.link) return
        navigate?.(data.link)
      })
      listening = true
    }

    const stream = new EventSource('/api/notifications/stream')
    source = stream
    stream.onopen = () => { connected.value = true }
    // Left to EventSource: it reconnects on its own, with backoff, and sends
    // the last id back so the two minutes it was away are not lost.
    stream.onerror = () => { connected.value = false }
    stream.onmessage = (event) => {
      try {
        show(JSON.parse(event.data) as StudioNotification)
      } catch {
        // A malformed frame is one missed banner, not a dead stream.
      }
    }

    // Resolving only once the connection is up is what makes "grant, then send
    // a test" work: nothing is stored for a tab that was not listening yet, and
    // a fresh connection is owed no backlog, so a banner published in the gap
    // is simply gone. Either outcome resolves — a stream that will not open is
    // not a reason to hang the caller, and it retries on its own regardless.
    await new Promise<void>((resolve) => {
      stream.addEventListener('open', () => resolve(), { once: true })
      stream.addEventListener('error', () => resolve(), { once: true })
    })
  }

  function stop() {
    source?.close()
    source = null
    connected.value = false
    // The worker listener stays: it costs nothing idle, and a click on a banner
    // posted before this stopped should still land somewhere.
  }

  return { permission, support, connected, refresh, request, start, stop }
}
