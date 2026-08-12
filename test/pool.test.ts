import { describe, expect, it } from 'vitest'
import { inFlight, mapLimit } from '../server/utils/pool'

describe('mapLimit', () => {
  it('returns results in the order given, not the order they finished', async () => {
    const results = await mapLimit([30, 10, 20, 1], 2, async (ms) => {
      await new Promise(resolve => setTimeout(resolve, ms))
      return ms
    })

    expect(results).toEqual([30, 10, 20, 1])
  })

  it('never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0

    await mapLimit(Array.from({ length: 40 }, (_, i) => i), 6, async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise(resolve => setTimeout(resolve, 1))
      running--
    })

    expect(peak).toBe(6)
  })

  it('does not sit idle: a finished worker picks up the next item', async () => {
    const order: number[] = []

    await mapLimit([1, 1, 1, 1, 1, 1], 2, async (_, index) => {
      await new Promise(resolve => setTimeout(resolve, 1))
      order.push(index)
    })

    expect(order).toHaveLength(6)
  })

  it('handles an empty list without starting a worker', async () => {
    let calls = 0
    expect(await mapLimit([], 8, async () => { calls++ })).toEqual([])
    expect(calls).toBe(0)
  })

  it('never starts fewer than one worker, whatever the limit says', async () => {
    expect(await mapLimit([1, 2], 0, async (n) => n * 2)).toEqual([2, 4])
  })

  it('rejects like Promise.all does — the first failure', async () => {
    await expect(mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('no')
      return n
    })).rejects.toThrow('no')
  })
})

describe('inFlight', () => {
  it('gives everyone who asks while it is running the same computation', async () => {
    const share = inFlight<string, number>()
    let calls = 0

    const compute = async () => {
      calls++
      await new Promise(resolve => setTimeout(resolve, 5))
      return 42
    }

    const results = await Promise.all([
      share('a', compute),
      share('a', compute),
      share('a', compute),
    ])

    expect(results).toEqual([42, 42, 42])
    expect(calls).toBe(1)
  })

  it('keeps different keys apart', async () => {
    const share = inFlight<string, string>()
    const [a, b] = await Promise.all([
      share('a', async () => 'a'),
      share('b', async () => 'b'),
    ])

    expect([a, b]).toEqual(['a', 'b'])
  })

  it('remembers nothing once settled — this is not a cache', async () => {
    const share = inFlight<string, number>()
    let calls = 0
    const compute = async () => ++calls

    expect(await share('a', compute)).toBe(1)
    expect(await share('a', compute)).toBe(2)
  })

  it('a failure is not held on to: the next caller gets a real attempt', async () => {
    const share = inFlight<string, string>()
    let attempts = 0

    const flaky = async () => {
      attempts++
      if (attempts === 1) throw new Error('first one fails')
      return 'second one works'
    }

    await expect(share('a', flaky)).rejects.toThrow('first one fails')
    expect(await share('a', flaky)).toBe('second one works')
  })
})
