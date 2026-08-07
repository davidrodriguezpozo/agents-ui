import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * A ritual due at 08:00 on a laptop that was shut.
 *
 * This is the most common way a ritual produces no work and, until it was
 * recorded, the only one that said nothing at all — the scheduler moved it to
 * tomorrow and the morning simply had no briefing in it.
 *
 * Two failures matter, and they pull in opposite directions:
 *
 *   - Saying nothing, which is what it did, and which is indistinguishable
 *     from the product being broken.
 *   - Saying it too loudly. Nothing was attempted, so a missed morning must not
 *     count as a failure — three shut laptops in a row would otherwise turn the
 *     ritual off for good, which is the precise opposite of what somebody
 *     coming back to a cold machine wants.
 */

let dir: string
let schedules: typeof import('../server/utils/schedules')
let scheduler: typeof import('../server/utils/scheduler')
let history: typeof import('../server/utils/ritualHistory')

const HOUR = 60 * 60_000

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-missed-'))
  process.env.CLAUDE_DIR = dir
  schedules = await import('../server/utils/schedules')
  scheduler = await import('../server/utils/scheduler')
  history = await import('../server/utils/ritualHistory')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
})

/** A ritual whose turn came `agoMs` ago and which nothing picked up. */
async function overdueBy(agoMs: number, now: number) {
  const saved = await schedules.upsertSchedule({
    title: 'Morning briefing',
    input: '/brief',
    recurrence: { hour: 8, minute: 0, days: [] },
  })

  await schedules.scheduleStore.update((all) => {
    const s = all.find(x => x.id === saved.id)!
    s.nextRunAt = now - agoMs
  })

  return saved.id
}

async function read(id: string) {
  return (await schedules.readSchedules()).find(s => s.id === id)!
}

/**
 * The boundary on its own. Tested here rather than through `tick`, because a
 * verdict of `fire` inside a test starts a real agent — which is how the first
 * draft of this file ended up making an API call and racing its own teardown.
 */
describe('deciding what an occurrence deserves', () => {
  const NOW = 1_000 * HOUR

  it('waits for one that has not come round yet', () => {
    expect(scheduler.dueVerdict(NOW + HOUR, NOW)).toBe('wait')
  })

  it('waits when there is no time set at all', () => {
    expect(scheduler.dueVerdict(undefined, NOW)).toBe('wait')
  })

  it('fires one that is merely a little late', () => {
    // Opening the lid at 08:20 should still give you this morning's.
    expect(scheduler.dueVerdict(NOW - 20 * 60_000, NOW)).toBe('fire')
    expect(scheduler.dueVerdict(NOW, NOW)).toBe('fire')
  })

  it('fires right up to the edge of the catch-up window', () => {
    expect(scheduler.dueVerdict(NOW - 2 * HOUR, NOW)).toBe('fire')
  })

  it('gives up on one past it, rather than arriving at teatime', () => {
    expect(scheduler.dueVerdict(NOW - 2 * HOUR - 1, NOW)).toBe('missed')
    expect(scheduler.dueVerdict(NOW - 9 * HOUR, NOW)).toBe('missed')
  })
})

describe('an occurrence that went by with nothing running', () => {
  const NOW = new Date(2026, 7, 4, 15, 0, 0).getTime()

  it('is recorded rather than passed over in silence', async () => {
    const id = await overdueBy(5 * HOUR, NOW)

    await scheduler.tick(NOW)

    const after = await read(id)
    expect(after.missedAt).toBe(NOW - 5 * HOUR)
    expect(after.missedNoticedAt).toBe(NOW)
  })

  it('still moves on to the next occurrence', async () => {
    // Recording it must not also mean firing it: 08:00 arriving at teatime is
    // the thing the catch-up window exists to prevent.
    const id = await overdueBy(5 * HOUR, NOW)

    await scheduler.tick(NOW)

    expect((await read(id)).nextRunAt).toBeGreaterThan(NOW)
  })

  it('keeps only the most recent, not one line per morning away', async () => {
    const id = await overdueBy(5 * HOUR, NOW)
    await scheduler.tick(NOW)

    // A second missed occurrence, a day later — also well outside the window,
    // so this tick records rather than runs.
    await schedules.scheduleStore.update((all) => {
      all.find(x => x.id === id)!.nextRunAt = NOW + 20 * HOUR
    })
    await scheduler.tick(NOW + 30 * HOUR)

    expect((await read(id)).missedAt).toBe(NOW + 20 * HOUR)
  })

  it('is forgotten once the ritual actually runs', async () => {
    const id = await overdueBy(5 * HOUR, NOW)
    await scheduler.tick(NOW)
    expect((await read(id)).missedAt).toBeDefined()

    await schedules.markRan(id, 'run-1')

    // The row must stop reporting a morning that has since been made good.
    const after = await read(id)
    expect(after.missedAt).toBeUndefined()
    expect(after.missedNoticedAt).toBeUndefined()
  })
})

describe('what a missed morning must not do', () => {
  const NOW = new Date(2026, 7, 4, 15, 0, 0).getTime()

  it('does not count against the ritual, however many are missed', () => {
    // The hazard this design exists to avoid: a miss recorded as a failed run
    // would join the failing streak, and `shouldGiveUp` turns a ritual off at
    // three. A fortnight away would come back to a ritual switched off.
    const missedRuns = history.summarizeRitualRuns([])

    expect(missedRuns.failingStreak).toBe(0)
  })

  it('leaves the ritual switched on', async () => {
    const id = await overdueBy(5 * HOUR, NOW)

    await scheduler.tick(NOW)

    expect((await read(id)).enabled).toBe(true)
    expect((await read(id)).pausedReason).toBeUndefined()
  })
})
