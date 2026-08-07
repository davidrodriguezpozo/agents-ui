import { afterEach, describe, expect, it } from 'vitest'
import {
  getTerminal, reapIdleTerminals, resizeTerminal, sendInput, startTerminal,
  stopTerminal, stopAllTerminals, IDLE_TIMEOUT_MS,
} from '../server/utils/terminal'

/**
 * A real shell, against a real pty.
 *
 * The framing is the part worth testing, and it is the part the first draft got
 * wrong. A line-delimited protocol cannot carry a terminal: `ls` with no Enter
 * must stay unsent, Ctrl-C is a bare \x03, and an arrow key is an escape
 * sequence with no newline in it. Every one of those is a byte stream, so the
 * payload travels base64 — which contains no newline, keeping the framing safe
 * — and arrives at the pty exactly as typed.
 */

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Plain text from under whatever prompt the machine's shell draws. Anchored on
 * ESC: an earlier version of this stripped every `=`, which turned `A=80` into
 * `A80` and made the assertions match nothing at all while looking fine.
 */
const strip = (s: string) => s
  .replace(/\x1b\][^\x07]*\x07/g, '')
  .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  .replace(/\x1b[=>()][0-9A-Za-z]?/g, '')

/** Collects output, and lets a test wait for something rather than guess. */
function attach(id: string) {
  const t = getTerminal(id)!
  let out = ''
  t.emitter.on('data', (d: string) => { out += d })

  return {
    get text() { return strip(out) },
    /** Drops echoed input, so only what the shell itself printed is matched. */
    said(pattern: RegExp, without: RegExp) {
      return pattern.test(strip(out).replace(without, ''))
    },
    async until(pattern: RegExp, ms = 6000) {
      const started = Date.now()
      while (Date.now() - started < ms) {
        if (pattern.test(strip(out))) return true
        await wait(100)
      }
      return false
    },
  }
}

afterEach(() => stopAllTerminals())

describe('a shell in the workspace', () => {
  it('starts, runs something, and says what it printed', async () => {
    startTerminal('t1', '/tmp')
    const seen = attach('t1')

    await wait(900)
    sendInput('t1', 'echo HELLO_FROM_SHELL\r')

    expect(await seen.until(/HELLO_FROM_SHELL/)).toBe(true)
  }, 20_000)

  it('runs in the directory it was given', async () => {
    startTerminal('t2', '/tmp')
    const seen = attach('t2')

    await wait(900)
    sendInput('t2', 'echo WD=$PWD\r')

    expect(await seen.until(/WD=\/(private\/)?tmp/)).toBe(true)
  }, 20_000)
})

describe('carrying bytes rather than lines', () => {
  it('leaves a half-typed command unsent until Enter arrives', async () => {
    // The bug the first framing had: this would have executed immediately.
    //
    // The marker is computed by the shell, so it can only come from *running*
    // the command. Matching a literal would be ambiguous, since the tty echoes
    // what was typed and the assertion could not tell echo from output.
    startTerminal('t3', '/tmp')
    const seen = attach('t3')

    await wait(900)
    sendInput('t3', 'echo VAL=$((6*7))')
    await wait(800)
    expect(seen.text).not.toMatch(/VAL=42/)

    sendInput('t3', '\r')
    expect(await seen.until(/VAL=42/)).toBe(true)
  }, 20_000)

  it('carries Ctrl-C, which no line-based protocol can express', async () => {
    startTerminal('t4', '/tmp')
    const seen = attach('t4')

    await wait(900)
    sendInput('t4', 'sleep 30\r')
    await wait(600)
    sendInput('t4', '\x03')
    await wait(400)
    sendInput('t4', 'echo BACK_AFTER_INTERRUPT\r')

    expect(await seen.until(/BACK_AFTER_INTERRUPT/)).toBe(true)
  }, 25_000)
})

describe('being a terminal rather than a pipe', () => {
  it('is a tty, and resizes on demand', async () => {
    startTerminal('t5', '/tmp')
    const seen = attach('t5')

    await wait(1000)
    // Computed, for the same reason as above: `TTY=1` cannot appear in the
    // echo of what was typed, so matching it means the shell answered.
    sendInput('t5', 'echo TTY=$(test -t 0 && echo 1 || echo 0)\r')
    expect(await seen.until(/TTY=1/)).toBe(true)

    resizeTerminal('t5', 132, 40)
    await wait(500)
    sendInput('t5', 'echo SIZE=$(tput cols)x$(tput lines)\r')

    expect(await seen.until(/SIZE=132x40/)).toBe(true)
  }, 25_000)
})

describe('not leaking shells', () => {
  it('closes one on request', async () => {
    startTerminal('t6', '/tmp')
    expect(getTerminal('t6')).toBeTruthy()

    stopTerminal('t6')
    expect(getTerminal('t6')).toBeUndefined()
  })

  it('leaves one alone while somebody is watching it', () => {
    const t = startTerminal('t7', '/tmp')
    t.attached = 1
    t.lastActivity = Date.now() - IDLE_TIMEOUT_MS - 1

    expect(reapIdleTerminals()).toBe(0)
    expect(getTerminal('t7')).toBeTruthy()
  })

  it('closes one nobody has watched for long enough', () => {
    // A shell holds a process, a pty and a buffer for as long as it lives.
    const t = startTerminal('t8', '/tmp')
    t.attached = 0
    t.lastActivity = Date.now() - IDLE_TIMEOUT_MS - 1

    expect(reapIdleTerminals()).toBe(1)
    expect(getTerminal('t8')).toBeUndefined()
  })

  it('refuses input to one that has gone', () => {
    startTerminal('t9', '/tmp')
    stopTerminal('t9')

    expect(sendInput('t9', 'echo x\r')).toBe(false)
    expect(resizeTerminal('t9', 100, 30)).toBe(false)
  })
})
