/**
 * The click handler for a browser notification, and nothing else.
 *
 * A notification posted with `new Notification()` dies with the page that made
 * it: close the tab and the banner goes, and its `onclick` goes with it. One
 * posted through a service worker registration outlives the tab, and its click
 * arrives here — in a worker the browser will start again just to deliver it.
 * That is the whole reason this file exists.
 *
 * It deliberately does not touch `fetch`. This app is a live view of a server
 * on the same machine; a worker sitting in front of its requests could only
 * ever serve something staler than the thing itself. No caching, no offline
 * page, no interception — one event.
 */

// A worker that waits for every old tab to close is a worker that ships a fix
// tomorrow. There is no cached state to invalidate, so taking over at once is
// free.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const link = event.notification.data && event.notification.data.link
  const target = new URL(link || '/', self.location.origin)

  event.waitUntil((async () => {
    // `includeUncontrolled`, because a tab loaded before this worker existed is
    // still a perfectly good tab to answer the click in.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const here = open.filter(client => new URL(client.url).origin === target.origin)

    // The focused one first: if you are already looking at a window, that is
    // the window the banner should move, not one behind it.
    const client = here.find(c => c.focused) || here[0]

    if (client) {
      await client.focus().catch(() => {})
      // Asking the page to route beats navigating it. `client.navigate()`
      // reloads — losing the session you were mid-way through reading — and
      // throws outright on a client this worker does not control.
      client.postMessage({ type: 'agents-studio:navigate', link: target.pathname + target.search + target.hash })
      return
    }

    await self.clients.openWindow(target.href)
  })())
})
