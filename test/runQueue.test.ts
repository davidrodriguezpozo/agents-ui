import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * How much unattended work may go at once.
 *
 * Nothing capped this before: ten rituals due at 08:00 started ten agents at
 * the same moment on a machine nobody was watching.
 */

let claudeDir: string
let queue: typeof import('../server/utils/runQueue')
let preferences: typeof import('../server/utils/preferences')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-queue-'))
  process.env.CLAUDE_DIR = claudeDir
  queue = await import('../server/utils/runQueue')
  preferences = await import('../server/utils/preferences')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
})

beforeEach(() => queue.resetRunQueue())

/** A job that will not finish until told, so overlap can be observed. */
function held() {
  let release!: () => void
  const done = new Promise<void>((resolve) => { release = resolve })
  return { done, release }
}

describe('withRunSlot', () => {
  it('lets only the limit through at once', async () => {
    await preferences.savePreferences({ maxConcurrentRuns: 2 })

    const jobs = [held(), held(), held()]
    let started = 0

    const all = jobs.map(job => queue.withRunSlot(async () => {
      started++
      await job.done
    }))

    await new Promise(r => setTimeout(r, 20))
    expect(started).toBe(2)
    expect(queue.queueDepth()).toMatchObject({ active: 2, waiting: 1 })

    jobs[0]!.release()
    await new Promise(r => setTimeout(r, 20))
    expect(started).toBe(3)

    jobs[1]!.release()
    jobs[2]!.release()
    await Promise.all(all)
  })

  it('gives the slot back when a job throws', async () => {
    // Otherwise the queue narrows every time something fails, until nothing
    // runs at all — and unattended work fails routinely.
    await preferences.savePreferences({ maxConcurrentRuns: 1 })

    await expect(queue.withRunSlot(async () => { throw new Error('nope') })).rejects.toThrow('nope')
    expect(queue.queueDepth().active).toBe(0)

    await expect(queue.withRunSlot(async () => 'fine')).resolves.toBe('fine')
  })

  it('runs everything at once when the limit is off', async () => {
    await preferences.savePreferences({ maxConcurrentRuns: 0 })

    const jobs = [held(), held(), held(), held()]
    let started = 0
    const all = jobs.map(job => queue.withRunSlot(async () => { started++; await job.done }))

    await new Promise(r => setTimeout(r, 20))
    expect(started).toBe(4)

    jobs.forEach(j => j.release())
    await Promise.all(all)
  })

  it('keeps its order, so the first thing waiting is the first thing run', async () => {
    await preferences.savePreferences({ maxConcurrentRuns: 1 })

    const first = held()
    const order: string[] = []

    const running = queue.withRunSlot(async () => { order.push('first'); await first.done })
    const second = queue.withRunSlot(async () => { order.push('second') })
    const third = queue.withRunSlot(async () => { order.push('third') })

    await new Promise(r => setTimeout(r, 20))
    first.release()
    await Promise.all([running, second, third])

    expect(order).toEqual(['first', 'second', 'third'])
  })
})
