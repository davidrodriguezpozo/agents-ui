/**
 * Start listening for banners as soon as a tab exists.
 *
 * Only where permission has already been granted — nothing here asks for it.
 * A permission prompt on page load is the thing browsers added gesture
 * requirements to stop, and rightly: it arrives before there is any reason to
 * say yes, and a `denied` is close to permanent. The ask lives on a button in
 * Settings, next to the sentence explaining what it buys.
 *
 * So this is only the resumption: a browser that said yes yesterday should be
 * told things today without anybody re-visiting Settings to switch it on.
 */
export default defineNuxtPlugin(() => {
  const { start } = useBrowserNotifications()

  // After hydration: `Notification.permission` and the service worker are both
  // browser-only, and starting a stream during mount competes with the first
  // paint for a connection.
  onNuxtReady(() => { void start() })
})
