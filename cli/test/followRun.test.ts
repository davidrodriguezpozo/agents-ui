import { describe, expect, it, vi } from 'vitest'
import { followRun, type EventSource } from '../runStream'

/** A source that hands out one recorded attempt per connection. */
function source(attempts: Record<string, unknown>[][]): {
  source: EventSource
  asked: (number | undefined)[]
} {
  const asked: (number | undefined)[] = []
  let attempt = 0

  return {
    asked,
    source: {
      // eslint-disable-next-line require-yield
      async *events(_path, options) {
        asked.push(options.query?.after as number | undefined)
        const frames = attempts[attempt++] ?? []
        for (const frame of frames) yield frame
      },
    },
  }
}

const NOW = { sleep: async () => {}, backoffMs: () => 0 }

describe('followRun', () => {
  it('folds a whole run and stops when it is done', async () => {
    const { source: events, asked } = source([[
      { type: 'status', status: 'running', seq: 0 },
      { type: 'text', text: 'hello', seq: 1 },
      { type: 'done', status: 'completed', seq: 2 },
    ]])

    const seen: string[] = []
    const run = await followRun(events, 'r1', {
      signal: new AbortController().signal,
      onRun: current => seen.push(current.status),
      ...NOW,
    })

    expect(run.output).toBe('hello')
    expect(run.status).toBe('completed')
    // Asked for the whole run the first time, and only once.
    expect(asked).toEqual([-1])
    expect(seen.at(-1)).toBe('completed')
  })

  it('reconnects from the last sequence it saw when the stream drops', async () => {
    const { source: events, asked } = source([
      [
        { type: 'status', status: 'running', seq: 0 },
        { type: 'text', text: 'half ', seq: 4 },
      ],
      [
        { type: 'text', text: 'the rest', seq: 5 },
        { type: 'done', status: 'completed', seq: 6 },
      ],
    ])

    const connected: boolean[] = []
    const run = await followRun(events, 'r1', {
      signal: new AbortController().signal,
      onRun: () => {},
      onConnected: state => connected.push(state),
      ...NOW,
    })

    // The second attempt resumes rather than replaying from the start, which is
    // what stops a reconnect duplicating the whole transcript.
    expect(asked).toEqual([-1, 4])
    expect(run.output).toBe('half the rest')
    expect(run.status).toBe('completed')
    expect(connected).toContain(false)
  })

  it('gives up the moment it is aborted, without another attempt', async () => {
    const controller = new AbortController()
    const { source: events, asked } = source([
      [{ type: 'text', text: 'partial', seq: 1 }],
      [{ type: 'done', status: 'completed', seq: 2 }],
    ])

    const run = await followRun(events, 'r1', {
      signal: controller.signal,
      onRun: () => controller.abort(),
      ...NOW,
    })

    expect(asked).toEqual([-1])
    expect(run.status).toBe('queued')
  })

  it('retries a connection that throws rather than treating it as the end', async () => {
    const asked: (number | undefined)[] = []
    let attempt = 0
    const events: EventSource = {
      async *events(_path, options) {
        asked.push(options.query?.after as number | undefined)
        if (attempt++ === 0) throw new Error('socket hung up')
        yield { type: 'done', status: 'failed', seq: 3 }
      },
    }

    const sleep = vi.fn(async () => {})
    const run = await followRun(events, 'r1', {
      signal: new AbortController().signal,
      onRun: () => {},
      sleep,
      backoffMs: () => 7,
    })

    expect(asked).toEqual([-1, -1])
    expect(sleep).toHaveBeenCalledWith(7)
    expect(run.status).toBe('failed')
  })
})
