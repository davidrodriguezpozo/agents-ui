import { beforeEach, describe, expect, it } from 'vitest'
import {
  publishBrowserNotification,
  recentBrowserNotifications,
  replayableNotifications,
  resetBrowserNotifications,
  subscribeBrowserNotifications,
} from '../server/utils/notifyBus'
import { notificationOptions, shouldNotify, type StudioNotification } from '../app/utils/browserNotifications'

/**
 * The browser is now where a notification is posted from, which buys one thing
 * — a click that comes back to the tab you already had — and costs another: it
 * only exists while something is listening. So the parts that have to hold are
 * that a tab which drops its connection catches up, that a tab opening fresh
 * does not get yesterday's backlog, and that four tabs do not draw four
 * banners for the same event.
 */

beforeEach(() => resetBrowserNotifications())

function publish(title: string) {
  return publishBrowserNotification({ kind: 'finished', title, body: 'done', link: '/sessions/a' })
}

describe('the pipe to open tabs', () => {
  it('hands a published notification to every listener', () => {
    const seenByFirst: string[] = []
    const seenBySecond: string[] = []
    const offFirst = subscribeBrowserNotifications(e => seenByFirst.push(e.title))
    const offSecond = subscribeBrowserNotifications(e => seenBySecond.push(e.title))

    publish('one')

    expect(seenByFirst).toEqual(['one'])
    expect(seenBySecond).toEqual(['one'])
    offFirst()
    offSecond()
  })

  it('stops delivering once a tab has gone', () => {
    const seen: string[] = []
    const off = subscribeBrowserNotifications(e => seen.push(e.title))
    publish('one')
    off()
    publish('two')

    expect(seen).toEqual(['one'])
  })

  it('publishes with nobody listening at all, which is the normal case', () => {
    // Work that runs unattended must not behave differently for being watched.
    expect(() => publish('alone')).not.toThrow()
    expect(recentBrowserNotifications()).toHaveLength(1)
  })

  it('gives every notification an id a client can use as a cursor', () => {
    const first = publish('one')
    const second = publish('two')

    expect(first.id).not.toBe(second.id)
  })
})

describe('what a reconnecting tab catches up on', () => {
  it('replays what it missed', () => {
    const first = publish('one')
    publish('two')
    publish('three')

    const missed = replayableNotifications(recentBrowserNotifications(), first.id, Date.now())

    expect(missed.map(e => e.title)).toEqual(['two', 'three'])
  })

  it('gives a tab opening fresh nothing at all', () => {
    publish('one')

    // No cursor means no history: a browser opened in the morning should not be
    // handed four banners about work that finished overnight.
    expect(replayableNotifications(recentBrowserNotifications(), undefined, Date.now())).toEqual([])
  })

  it('drops anything older than the replay window', () => {
    const first = publish('one')
    publish('two')

    const later = Date.now() + 10 * 60_000

    expect(replayableNotifications(recentBrowserNotifications(), first.id, later)).toEqual([])
  })

  it('ignores a cursor from a previous boot rather than trusting its numbers', () => {
    publish('one')
    publish('two')

    // A counter that restarts at zero would have this tab silently drop the
    // next few notifications as things it had supposedly already seen.
    const stale = 'someotherboot-1'

    expect(replayableNotifications(recentBrowserNotifications(), stale, Date.now())).toEqual([])
  })

  it('ignores a cursor that is not a number', () => {
    publish('one')
    const [entry] = recentBrowserNotifications()
    const boot = entry!.id.split('-')[0]

    expect(replayableNotifications(recentBrowserNotifications(), `${boot}-nonsense`, Date.now())).toEqual([])
  })
})

describe('whether a tab draws the banner', () => {
  const entry: StudioNotification = {
    id: 'boot-1',
    kind: 'needsYou',
    title: 'Blocked',
    body: 'waiting on a permission',
    link: '/sessions/abc',
    at: 0,
  }

  it('stays quiet about the page you are looking at', () => {
    const tab = { visible: true, focused: true, path: '/sessions/abc' }

    expect(shouldNotify(entry, tab, new Set())).toBe(false)
  })

  it('still notifies a visible window that is not the one being used', () => {
    // A second monitor with the app open on it is exactly the case this is for.
    const tab = { visible: true, focused: false, path: '/sessions/abc' }

    expect(shouldNotify(entry, tab, new Set())).toBe(true)
  })

  it('notifies when you are somewhere else in the app', () => {
    const tab = { visible: true, focused: true, path: '/schedules' }

    expect(shouldNotify(entry, tab, new Set())).toBe(true)
  })

  it('ignores the query string and hash when comparing', () => {
    const tab = { visible: true, focused: true, path: '/sessions/abc?tab=diff#top' }

    expect(shouldNotify(entry, tab, new Set())).toBe(false)
  })

  it('never draws the same notification twice', () => {
    // A reconnect replays the last two minutes, so a repeat is expected rather
    // than exceptional.
    const tab = { visible: false, focused: false, path: '/' }

    expect(shouldNotify(entry, tab, new Set([entry.id]))).toBe(false)
  })
})

describe('how the banner is drawn', () => {
  const entry: StudioNotification = {
    id: 'boot-7',
    kind: 'needsYou',
    title: 'Blocked',
    body: 'waiting on a permission',
    link: '/sessions/abc',
    at: 1234,
  }

  it('tags by id, so four open tabs show one banner rather than four', () => {
    expect(notificationOptions(entry).tag).toBe('boot-7')
  })

  it('carries the link, which is what the click handler has to work with', () => {
    expect((notificationOptions(entry).data as { link: string }).link).toBe('/sessions/abc')
  })

  it('makes something blocked on you stay on screen', () => {
    // A banner that faded while you were making coffee is the exact failure
    // this feature exists to prevent.
    expect(notificationOptions(entry).requireInteraction).toBe(true)
  })

  it('lets a report fade, because a report can wait', () => {
    expect(notificationOptions({ ...entry, kind: 'finished' }).requireInteraction).toBe(false)
  })
})
