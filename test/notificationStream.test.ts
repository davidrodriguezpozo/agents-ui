import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The endpoint a tab holds open for as long as it is a tab.
 *
 * It runs inside Nitro, whose helpers are auto-imported rather than imported,
 * so they are stubbed here — which is what the vitest config already says about
 * anything relying on them. What is worth testing is the framing: EventSource
 * only sends `Last-Event-ID` back on a reconnect if the server sent `id:` lines
 * in the first place, so a missing line here is a reconnect that silently loses
 * everything it was away for.
 */

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.setResponseHeaders = vi.fn()
globals.getHeader = (event: FakeEvent, name: string) => event.headers[name]
globals.getQuery = () => ({})

const { publishBrowserNotification, resetBrowserNotifications } = await import('../server/utils/notifyBus')
// Through `unknown`: the handler is typed for Nitro's event, and the fake one
// below is only the two fields it actually touches.
const stream = (await import('../server/api/notifications/stream.get')).default as unknown as
  (event: FakeEvent) => Promise<void>

interface FakeEvent {
  headers: Record<string, string | undefined>
  node: { req: EventEmitter; res: { write: (chunk: string) => void; end: () => void } }
}

function connect(lastEventId?: string) {
  const written: string[] = []
  const req = new EventEmitter() as EventEmitter & { off: EventEmitter['off'] }
  const event: FakeEvent = {
    headers: { 'last-event-id': lastEventId },
    node: { req, res: { write: chunk => void written.push(chunk), end: () => {} } },
  }

  const done = stream(event)
  return { written, close: () => req.emit('close'), done }
}

beforeEach(() => resetBrowserNotifications())

describe('the stream a tab holds open', () => {
  it('frames each notification with the id a reconnect resumes from', async () => {
    const session = connect()
    const entry = publishBrowserNotification({
      kind: 'needsYou', title: 'Blocked', body: 'waiting', link: '/sessions/a',
    })

    session.close()
    await session.done

    const frame = session.written.find(chunk => chunk.includes('data:'))!

    expect(frame.startsWith(`id: ${entry.id}\n`)).toBe(true)
    expect(JSON.parse(frame.split('data: ')[1]!)).toMatchObject({ title: 'Blocked', link: '/sessions/a' })
  })

  it('catches a reconnecting tab up on what it missed', async () => {
    const first = publishBrowserNotification({ kind: 'finished', title: 'one', body: '', link: '/' })
    publishBrowserNotification({ kind: 'finished', title: 'two', body: '', link: '/' })

    const session = connect(first.id)
    session.close()
    await session.done

    const titles = session.written
      .filter(chunk => chunk.includes('data: '))
      .map(chunk => JSON.parse(chunk.split('data: ')[1]!).title)

    expect(titles).toEqual(['two'])
  })

  it('sends a fresh tab nothing but the opening comment', async () => {
    publishBrowserNotification({ kind: 'finished', title: 'overnight', body: '', link: '/' })

    const session = connect()
    session.close()
    await session.done

    expect(session.written).toEqual([': open\n\n'])
  })

  it('stops listening when the tab goes, rather than writing to a dead socket', async () => {
    const session = connect()
    session.close()
    await session.done

    const before = session.written.length
    publishBrowserNotification({ kind: 'finished', title: 'after', body: '', link: '/' })

    expect(session.written).toHaveLength(before)
  })
})
