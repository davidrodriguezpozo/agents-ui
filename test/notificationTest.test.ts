import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The "send a test" button, which is the only thing in the app whose entire
 * job is to prove that a notification arrives.
 *
 * It earns a test of its own because it once failed at exactly that: the banner
 * was published, delivered, and then dropped by the tab for being about the
 * page the button is on. So what is checked here is the flag that makes it
 * unconditional, and that it goes down whichever channel is configured rather
 * than whichever one is easiest — a test that proves a channel you are not
 * using proves nothing.
 */

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler

const channel = { value: 'browser' as 'browser' | 'system' | 'both' }
const system = vi.fn(async () => {})

vi.mock('../server/utils/preferences', () => ({
  readPreferences: async () => ({ notifications: { channel: channel.value } }),
}))

vi.mock('../server/utils/notify', () => ({
  bannerText: (text: string) => text,
  studioUrl: (path: string) => `http://127.0.0.1:3000${path}`,
  postSystemNotification: (...args: unknown[]) => system(...(args as [])),
}))

const { subscribeBrowserNotifications, resetBrowserNotifications } = await import('../server/utils/notifyBus')
// Through `unknown`: the handler is typed for Nitro's event and is called with
// none of it, because this one reads nothing off the request.
const send = (await import('../server/api/notifications/test.post')).default as unknown as () => Promise<unknown>

beforeEach(() => {
  resetBrowserNotifications()
  system.mockClear()
  channel.value = 'browser'
})

function published() {
  const seen: { test?: true; link: string }[] = []
  const off = subscribeBrowserNotifications(entry => void seen.push(entry))
  return { seen, off }
}

describe('the test notification', () => {
  it('is marked as a test, so the tab shows it whatever page you are on', async () => {
    const listener = published()
    await send()
    listener.off()

    expect(listener.seen).toHaveLength(1)
    expect(listener.seen[0]!.test).toBe(true)
  })

  it('points at the notification settings it was pressed from', async () => {
    const listener = published()
    await send()
    listener.off()

    expect(listener.seen[0]!.link).toBe('/settings#settings-notifications')
  })

  it('leaves the desktop alone when the browser is the chosen channel', async () => {
    const listener = published()
    await send()
    listener.off()

    expect(system).not.toHaveBeenCalled()
  })

  it('posts to the desktop instead when that is the chosen channel', async () => {
    channel.value = 'system'
    const listener = published()
    await send()
    listener.off()

    expect(listener.seen).toEqual([])
    expect(system).toHaveBeenCalledOnce()
  })

  it('proves both at once when both are configured', async () => {
    channel.value = 'both'
    const listener = published()
    await send()
    listener.off()

    expect(listener.seen).toHaveLength(1)
    expect(system).toHaveBeenCalledOnce()
  })
})
