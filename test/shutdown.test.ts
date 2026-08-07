import { afterEach, describe, expect, it, vi } from 'vitest'
import { onShutdown, runShutdownTasks } from '../server/utils/shutdown'

/**
 * Cleaning up things that outlive this process.
 *
 * Nitro's `close` hook covers a graceful shutdown and nothing else — a plain
 * `kill`, which is what a service manager sends, never reaches it. That is
 * survivable for most state and not for a child spawned *detached*, which is
 * what a preview is so that stopping it can signal its whole process group.
 *
 * The bug: killing the app with a preview running left `node server.js` alive,
 * holding its port, a minute and a half later.
 */

afterEach(() => {
  // Drain anything a test registered, so it cannot run during another.
  runShutdownTasks()
  vi.restoreAllMocks()
})

describe('running cleanup on the way out', () => {
  it('runs what was registered', () => {
    const done: string[] = []
    onShutdown(() => done.push('previews'))
    onShutdown(() => done.push('terminals'))

    runShutdownTasks()

    expect(done).toEqual(['previews', 'terminals'])
  })

  it('runs each task once, however many times it is asked', () => {
    // A second signal arriving during shutdown must not kill things twice.
    let count = 0
    onShutdown(() => { count++ })

    runShutdownTasks()
    runShutdownTasks()

    expect(count).toBe(1)
  })

  it('carries on when one task throws', () => {
    // There is nothing left to report a failure to, and the remaining
    // cleanups are exactly what stops a process being orphaned.
    const done: string[] = []
    onShutdown(() => { throw new Error('kill failed') })
    onShutdown(() => done.push('ran anyway'))

    expect(() => runShutdownTasks()).not.toThrow()
    expect(done).toEqual(['ran anyway'])
  })
})

describe('the signals it listens for', () => {
  it('handles the ones a service manager and a terminal actually send', () => {
    // Registering a listener replaces Node's default action for these, which
    // is why exiting is this module's job rather than the runtime's.
    onShutdown(() => {})

    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
      expect(process.listenerCount(signal), signal).toBeGreaterThan(0)
    }
  })

  it('installs those listeners once, not once per task', () => {
    const before = process.listenerCount('SIGTERM')

    onShutdown(() => {})
    onShutdown(() => {})
    onShutdown(() => {})

    expect(process.listenerCount('SIGTERM')).toBe(before)
  })
})
