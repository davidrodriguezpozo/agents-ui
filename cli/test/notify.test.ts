import { describe, expect, it } from 'vitest'
import { alertFor, asNotification, notificationLine, watchNotifications } from '../notify'
import type { StudioNotification } from '../types'

function notification(over: Partial<StudioNotification> = {}): StudioNotification {
  return {
    id: 'boot-1',
    kind: 'needsYou',
    title: 'Fix the flaky test',
    body: 'wants to run gh pr create',
    link: '/sessions/s1',
    at: Date.UTC(2026, 0, 2, 9, 30),
    ...over,
  }
}

describe('asNotification', () => {
  it('takes the frames it understands and drops the rest', () => {
    expect(asNotification({ ...notification() })?.kind).toBe('needsYou')
    expect(asNotification({ kind: 'wat', id: 'x', title: 'y' })).toBeNull()
    expect(asNotification({ kind: 'finished', title: 'no id' })).toBeNull()
    // A heartbeat comment never reaches here as data, but a frame without our
    // fields might, and it must not become an empty banner.
    expect(asNotification({})).toBeNull()
  })

  it('fills in what the server left out', () => {
    const parsed = asNotification({ id: 'b-2', kind: 'failed', title: 'Ritual failed' })
    expect(parsed).toMatchObject({ body: '', link: '/' })
    expect(typeof parsed?.at).toBe('number')
  })
})

describe('alertFor', () => {
  it('rings only for the one that means a person is needed', () => {
    expect(alertFor(notification())).toContain('\x07')
    expect(alertFor(notification({ kind: 'finished' }))).toBe('')
    expect(alertFor(notification({ kind: 'failed' }))).toBe('')
  })

  it('does not let a title carry control characters into the terminal', () => {
    const alert = alertFor(notification({ title: 'bad\x1b]0;title\x07', body: '' }))
    expect(alert.startsWith('\x07\x1b]9;')).toBe(true)
    expect(alert.slice(4, -1)).not.toContain('\x1b')
  })
})

describe('notificationLine', () => {
  it('reads as one line, for a pipe or a split', () => {
    expect(notificationLine(notification())).toContain('Fix the flaky test')
    expect(notificationLine(notification()).split('\n')).toHaveLength(1)
    expect(notificationLine(notification({ kind: 'failed' }))).toContain('✕')
  })
})

describe('watchNotifications', () => {
  it('resumes from the last id it saw', async () => {
    const asked: (string | undefined)[] = []
    const controller = new AbortController()

    const source = {
      async *events(_path: string, options: { query?: Record<string, unknown> }) {
        asked.push(options.query?.after as string | undefined)
        // The second connection is the one that proves the cursor; stopping
        // there keeps the retry loop from spinning for the rest of the suite.
        if (asked.length >= 2) {
          controller.abort()
          return
        }
        yield { ...notification({ id: 'boot-7' }) }
      },
    }

    const seen: StudioNotification[] = []
    await watchNotifications(source, {
      signal: controller.signal,
      onNotification: item => seen.push(item),
      sleep: async () => {},
    })

    expect(seen).toHaveLength(1)
    expect(asked[0]).toBeUndefined()
    expect(asked[1]).toBe('boot-7')
  })
})
