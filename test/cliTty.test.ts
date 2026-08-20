import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { releaseTty } from '../cli/shell'

/**
 * Handing the terminal to a child process.
 *
 * The bug this guards against was invisible in a test and fatal in a terminal:
 * stdin still being read while an interactive shell owned the foreground
 * process group, which stopped the whole job with "suspended (tty input)" or
 * killed the app with EIO. What matters is that the file descriptor stops
 * being read — not that the stream says it is paused — and that everything
 * comes back afterwards.
 */

function fakeStdin() {
  const stream = new EventEmitter() as unknown as NodeJS.ReadStream & {
    calls: string[]
    isRaw: boolean
  }
  const calls: string[] = []
  Object.assign(stream, {
    isTTY: true,
    isRaw: true,
    calls,
    _handle: {
      readStart: () => { calls.push('readStart') },
      readStop: () => { calls.push('readStop') },
    },
    pause: () => { calls.push('pause'); return stream },
    resume: () => { calls.push('resume'); return stream },
    setRawMode: (mode: boolean) => {
      calls.push(`raw:${mode}`)
      stream.isRaw = mode
      return stream
    },
  })
  return stream
}

describe('releaseTty', () => {
  it('stops the read on the handle, not just the stream', () => {
    const stdin = fakeStdin()
    releaseTty(stdin)
    expect(stdin.calls).toContain('readStop')
    expect(stdin.isRaw).toBe(false)
  })

  it('gives raw mode and the read back, in that order', () => {
    const stdin = fakeStdin()
    const takeBack = releaseTty(stdin)
    stdin.calls.length = 0
    takeBack()
    expect(stdin.calls).toEqual(['readStart', 'raw:true'])
    expect(stdin.isRaw).toBe(true)
  })

  it('survives a tty that will not stop, rather than losing the app', () => {
    const stdin = fakeStdin()
    Object.assign(stdin, { _handle: { readStop: () => { throw new Error('nope') } } })
    expect(() => releaseTty(stdin)()).not.toThrow()
  })

  it('falls back to the stream where there is no handle to start', () => {
    const stdin = fakeStdin()
    Object.assign(stdin, { _handle: undefined })
    const takeBack = releaseTty(stdin)
    expect(stdin.calls).toEqual(['raw:false', 'pause'])
    takeBack()
    expect(stdin.calls).toEqual(['raw:false', 'pause', 'resume', 'raw:true'])
  })

  it('leaves no error or signal handler behind', () => {
    const stdin = fakeStdin()
    const before = {
      ttin: process.listenerCount('SIGTTIN'),
      ttou: process.listenerCount('SIGTTOU'),
    }
    const takeBack = releaseTty(stdin)
    expect(process.listenerCount('SIGTTIN')).toBe(before.ttin + 1)
    expect(process.listenerCount('SIGTTOU')).toBe(before.ttou + 1)
    // An EIO arriving mid-handover must not reach anyone else.
    expect(() => stdin.emit('error', new Error('read EIO'))).not.toThrow()
    takeBack()
    expect(process.listenerCount('SIGTTIN')).toBe(before.ttin)
    expect(process.listenerCount('SIGTTOU')).toBe(before.ttou)
    expect(stdin.listenerCount('error')).toBe(0)
  })

  it('does not turn raw mode on for a terminal that never had it', () => {
    const stdin = fakeStdin()
    stdin.isRaw = false
    const takeBack = releaseTty(stdin)
    stdin.calls.length = 0
    takeBack()
    expect(stdin.calls).toEqual(['readStart'])
  })
})
