import { bannerText, postSystemNotification, studioUrl } from '../../utils/notify'
import { publishBrowserNotification } from '../../utils/notifyBus'
import { readPreferences } from '../../utils/preferences'

/**
 * Prove the pipe, from Settings.
 *
 * A browser notification has four places to fail silently — permission, the
 * service worker, the stream, and the machine's own Do Not Disturb — and none
 * of them announce themselves. Nobody should discover which one it was by
 * missing a blocked run at three in the morning.
 *
 * It goes down whichever channel is configured, so what it proves is what will
 * actually happen. It does not go through `notify`, because the master switch
 * and the per-kind switches would make a silent test mean two different things
 * and only tell you about one of them.
 */
export default defineEventHandler(async () => {
  const { notifications } = await readPreferences()

  const title = 'Agents Studio'
  const body = bannerText('Notifications are working. Clicking this opens the app.')
  const link = '/settings#settings-notifications'

  if (notifications.channel !== 'system') {
    publishBrowserNotification({ kind: 'finished', title, body, link, test: true })
  }

  if (notifications.channel !== 'browser') {
    await postSystemNotification(title, body, studioUrl(link))
  }

  return { channel: notifications.channel }
})
