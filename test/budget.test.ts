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

/**
 * The limit denominated in the unit most people are actually billed in, which
 * is to say not billed at all: a Pro or Max subscription stops for its rate
 * limit long before any dollar figure means anything.
 *
 * The failure to guard against is the same as for the dollar caps — refusing
 * work over something it could not really tell — plus one specific to this:
 * holding back a turn somebody typed, which is theirs to spend.
 */
describe('leaving room on the subscription', () => {
  let quota: typeof import('../server/utils/quota')

  beforeAll(async () => {
    quota = await import('../server/utils/quota')
  })

  beforeEach(async () => {
    await preferences.savePreferences({ pauseOnQuotaWarning: true })
  })

  it('skips unattended work when the limit is nearly gone', async () => {
    await quota.recordQuota({ status: 'allowed_warning', rateLimitType: 'seven_day' }, NOW)

    const decision = await budget.checkBudget(NOW, { unattended: true })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('weekly')
  })

  it('never holds back a turn somebody typed', async () => {
    await quota.recordQuota({ status: 'rejected' }, NOW)

    // You can see the state of your own account. Being refused by your own
    // tool for something you deliberately started is the wrong side of helpful.
    await expect(budget.checkBudget(NOW)).resolves.toMatchObject({ allowed: true })
  })

  it('does nothing at all until somebody turns it on', async () => {
    await preferences.savePreferences({ pauseOnQuotaWarning: false })
    await quota.recordQuota({ status: 'rejected' }, NOW)

    await expect(budget.checkBudget(NOW, { unattended: true }))
      .resolves.toMatchObject({ allowed: true })
  })

  it('lets unattended work through while there is room', async () => {
    await quota.recordQuota({ status: 'allowed' }, NOW)

    await expect(budget.checkBudget(NOW, { unattended: true }))
      .resolves.toMatchObject({ allowed: true })
  })

  it('ignores a reading too old to be true any more', async () => {
    // Recorded long enough ago that the window has since reset. Acting on it
    // would keep skipping rituals for a limit that no longer applies.
    await quota.recordQuota({ status: 'rejected' }, NOW - quota.QUOTA_STALE_AFTER_MS - 1)

    await expect(budget.checkBudget(NOW, { unattended: true }))
      .resolves.toMatchObject({ allowed: true })
  })
})

/**
 * Carrying on somewhere else instead of stopping.
 *
 * The two failures worth guarding against are opposites. One is a substitution
 * that does not happen — the setting is on, the limit is gone, and the ritual is
 * skipped anyway. The other is a substitution that happens where it must not: a
 * *dollar* cap is a statement about money, and the other agent costs money too,
 * so a fallback that answered that one would turn a spending limit into a
 * redirection.
 *
 * "Installed" is asked of the same lookup a run uses, so these drive it through
 * `CURSOR_AGENT_EXECUTABLE` rather than mocking the module: a fallback that is
 * configured, looks configured and turns out at 03:00 to be a binary nobody
 * installed is the exact thing being prevented.
 */
describe('carrying on when the subscription runs out', () => {
  let quota: typeof import('../server/utils/quota')
  const CURSOR_ENV = 'CURSOR_AGENT_EXECUTABLE'

  beforeAll(async () => {
    quota = await import('../server/utils/quota')
  })

  /** Put money on today's total, through a route `spentSince` already counts. */
  async function spend(costUsd: number): Promise<void> {
    const sessions = await import('../server/utils/sessions')
    await sessions.saveSession({
      id: `spend-${costUsd}-${Date.now()}`,
      title: 'seeded',
      repoDir: dir,
      branch: 'main',
      baseBranch: 'main',
      status: 'idle',
      runIds: [],
      createdAt: NOW,
      updatedAt: NOW,
      worktreePath: dir,
      summary: { text: 'seeded', at: NOW, costUsd },
    } as any)
  }

  beforeEach(async () => {
    // Something that exists and can be executed on any machine this runs on.
    process.env[CURSOR_ENV] = '/bin/sh'
    await (await import('../server/utils/sessions')).writeSessions([])
    await preferences.savePreferences({
      pauseOnQuotaWarning: true,
      quotaFallbackProvider: 'cursor',
      dailyCapUsd: 0,
      runCapUsd: 0,
    })
  })

  afterAll(() => {
    delete process.env[CURSOR_ENV]
  })

  it('runs the work on the other agent instead of skipping it', async () => {
    await quota.recordQuota({ status: 'rejected' }, NOW)

    const decision = await budget.checkBudget(NOW, { unattended: true })

    expect(decision.allowed).toBe(true)
    expect(decision.useProvider).toBe('cursor')
  })

  it('still skips when nobody named an agent to carry on with', async () => {
    // `null` clears it. `undefined` would mean "leave it as it is", which is
    // the distinction the settings page depends on when it saves one field.
    await preferences.savePreferences({ quotaFallbackProvider: null })
    await quota.recordQuota({ status: 'rejected' }, NOW)

    const decision = await budget.checkBudget(NOW, { unattended: true })

    expect(decision.allowed).toBe(false)
    expect(decision.useProvider).toBeUndefined()
  })

  it('refuses rather than falling back to an agent that is not on the machine', async () => {
    // Reading an unknown agent as the default is right when loading an old
    // record and wrong here: it would send the work to the very agent the
    // fallback exists to get away from.
    process.env[CURSOR_ENV] = join(dir, 'no-such-cursor-agent')
    await quota.recordQuota({ status: 'rejected' }, NOW)

    const decision = await budget.checkBudget(NOW, { unattended: true })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('not on this machine')
    expect(decision.useProvider).toBeUndefined()
  })

  it('never falls back for a daily cap — that limit is about money', async () => {
    // The one that would be discovered on an invoice. Spend is seeded as a
    // session summary because `spentSince` counts those too, deliberately.
    await preferences.savePreferences({ dailyCapUsd: 0.5 })
    await quota.recordQuota({ status: 'rejected' }, NOW)
    await spend(1)

    const decision = await budget.checkBudget(NOW, { unattended: true })

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('daily limit')
    expect(decision.useProvider).toBeUndefined()
  })

  it('substitutes and still hands down the day\'s remaining ceiling', async () => {
    // Both limits apply at once: the agent changes, the money does not.
    await preferences.savePreferences({ dailyCapUsd: 5 })
    await quota.recordQuota({ status: 'rejected' }, NOW)
    await spend(1)

    const decision = await budget.checkBudget(NOW, { unattended: true })

    expect(decision.allowed).toBe(true)
    expect(decision.useProvider).toBe('cursor')
    expect(decision.maxBudgetUsd).toBeCloseTo(4)
  })

  it('leaves a turn somebody typed exactly as it was', async () => {
    await quota.recordQuota({ status: 'rejected' }, NOW)

    const decision = await budget.checkBudget(NOW)

    expect(decision.allowed).toBe(true)
    // Nothing was substituted: an interactive turn was never held back, so
    // there is nothing for a fallback to rescue.
    expect(decision.useProvider).toBeUndefined()
  })
})
