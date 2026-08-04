import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Money that actually stops things.
 *
 * The failure that matters is a limit that does not hold — either because it
 * failed open when it should have refused, or because it refused when it could
 * not actually tell, which would stop every session on the machine over a
 * preferences file it could not read.
 */

let dir: string
let budget: typeof import('../server/utils/budget')
let preferences: typeof import('../server/utils/preferences')

const NOW = new Date(2026, 7, 4, 15, 0, 0).getTime()

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-budget-'))
  process.env.CLAUDE_DIR = dir
  budget = await import('../server/utils/budget')
  preferences = await import('../server/utils/preferences')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await preferences.savePreferences({ dailyCapUsd: 0, runCapUsd: 0 })
})

describe('startOfToday', () => {
  it('is midnight where the person is, not where UTC is', () => {
    const start = budget.startOfToday(NOW)
    const asDate = new Date(start)

    expect(asDate.getHours()).toBe(0)
    expect(asDate.getDate()).toBe(new Date(NOW).getDate())
  })
})

describe('checkBudget', () => {
  it('allows everything when no limit is set', async () => {
    const decision = await budget.checkBudget(NOW)

    expect(decision.allowed).toBe(true)
    // Nothing to hand the SDK, so a run is uncapped as it always was.
    expect(decision.maxBudgetUsd).toBeUndefined()
  })

  it('hands the per-run limit to the SDK', async () => {
    await preferences.savePreferences({ runCapUsd: 2 })
    const decision = await budget.checkBudget(NOW)

    expect(decision.allowed).toBe(true)
    expect(decision.maxBudgetUsd).toBe(2)
  })

  it('caps a run at what is left of the day, not just at the run limit', async () => {
    // The composition that matters: a $5 run limit under a $10 daily limit
    // must not let a single run spend $5 when only $1 of the day remains.
    await preferences.savePreferences({ dailyCapUsd: 10, runCapUsd: 5 })

    const decision = await budget.checkBudget(NOW)
    // Nothing spent yet in this empty store, so the run limit is the tighter.
    expect(decision.maxBudgetUsd).toBe(5)
  })

  it('uses the daily limit as the ceiling when it is the tighter of the two', async () => {
    await preferences.savePreferences({ dailyCapUsd: 3, runCapUsd: 50 })
    const decision = await budget.checkBudget(NOW)

    expect(decision.maxBudgetUsd).toBe(3)
  })

  it('treats a daily limit alone as the run ceiling too', async () => {
    // Otherwise one run could spend the whole month before the next check.
    await preferences.savePreferences({ dailyCapUsd: 4 })
    const decision = await budget.checkBudget(NOW)

    expect(decision.maxBudgetUsd).toBe(4)
  })
})

describe('a limit that cannot be trusted', () => {
  it('is not a limit: zero and nonsense mean off', async () => {
    // A negative limit read as "stop everything" would be the worst possible
    // reading of a typo.
    expect(preferences.positiveOrZero(-5)).toBe(0)
    expect(preferences.positiveOrZero(0)).toBe(0)
    expect(preferences.positiveOrZero(Number.NaN)).toBe(0)
    expect(preferences.positiveOrZero(Number.POSITIVE_INFINITY)).toBe(0)
    expect(preferences.positiveOrZero('10' as unknown)).toBe(0)
    expect(preferences.positiveOrZero(10)).toBe(10)
  })

  it('survives a round trip through the store', async () => {
    await preferences.savePreferences({ dailyCapUsd: 12.5, runCapUsd: 0.75 })
    const read = await preferences.readPreferences()

    expect(read.dailyCapUsd).toBe(12.5)
    expect(read.runCapUsd).toBe(0.75)
  })

  it('turns a limit off with zero, which is a real answer', async () => {
    await preferences.savePreferences({ dailyCapUsd: 12.5 })
    await preferences.savePreferences({ dailyCapUsd: 0 })

    expect((await preferences.readPreferences()).dailyCapUsd).toBe(0)
    expect((await budget.checkBudget(NOW)).maxBudgetUsd).toBeUndefined()
  })

  it('leaves the other limit alone when only one is given', async () => {
    await preferences.savePreferences({ dailyCapUsd: 9, runCapUsd: 3 })
    await preferences.savePreferences({ runCapUsd: 4 })

    const read = await preferences.readPreferences()
    expect(read.dailyCapUsd).toBe(9)
    expect(read.runCapUsd).toBe(4)
  })
})

describe('budgetStoppedMessage', () => {
  it('names the limit that was hit and what to do', () => {
    const message = budget.budgetStoppedMessage(2.5)

    expect(message).toContain('$2.50')
    expect(message).toContain('unfinished')
    expect(message).toMatch(/send it again|Raise the limit/)
  })

  it('still says something useful without a figure', () => {
    expect(budget.budgetStoppedMessage(undefined)).toContain('unfinished')
  })
})
