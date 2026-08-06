import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SessionCheck } from '../server/utils/checks'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * The loop that lets a session fix its own failing checks.
 *
 * These exercise the decision, not the turn: whether another attempt is owed,
 * how many are left, and what ends a streak. The turn itself is `startTurn`,
 * which is tested by being the same code path a person's message takes.
 */

let claudeDir: string
let sessions: typeof import('../server/utils/sessions')
let preferences: typeof import('../server/utils/preferences')
let repair: typeof import('../server/utils/sessionRepair')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-repair-'))
  process.env.CLAUDE_DIR = claudeDir

  sessions = await import('../server/utils/sessions')
  preferences = await import('../server/utils/preferences')
  repair = await import('../server/utils/sessionRepair')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await preferences.savePreferences({ repairAttempts: 0 })
})

function verdict(status: SessionCheck['status'], output = 'value.txt does not say good'): SessionCheck {
  return {
    status,
    command: 'make check',
    fingerprint: 'abc123',
    exitCode: status === 'passing' ? 0 : 1,
    output,
    durationMs: 1200,
    at: Date.now(),
  }
}

let counter = 0
async function session(patch: Partial<import('../server/utils/sessions').Session> = {}) {
  const id = `repair-${++counter}`
  return sessions.saveSession({
    id,
    title: id,
    repoDir: '/tmp/repo',
    worktreePath: `/tmp/repo/.worktrees/${id}`,
    branch: id,
    baseBranch: 'main',
    baseSha: 'deadbeef',
    status: 'idle',
    runIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...patch,
  })
}

describe('planRepair', () => {
  it('does nothing at all when the preference is off', async () => {
    const s = await session()
    expect(await repair.planRepair(s.id, verdict('failing'))).toBeNull()
    expect((await sessions.findSession(s.id))?.repair).toBeUndefined()
  })

  it('hands out a turn carrying the failure when it is switched on', async () => {
    await preferences.savePreferences({ repairAttempts: 3 })
    const s = await session()

    const prompt = await repair.planRepair(s.id, verdict('failing'))

    expect(prompt).toContain('make check')
    expect(prompt).toContain('value.txt does not say good')
    expect((await sessions.findSession(s.id))?.repair).toMatchObject({
      attempts: 1, max: 3, state: 'running',
    })
  })

  it('tells the agent not to delete the test to make it pass', async () => {
    await preferences.savePreferences({ repairAttempts: 1 })
    const s = await session()

    const prompt = await repair.planRepair(s.id, verdict('failing'))

    // The shortest path from red to green is deleting the assertion, so the
    // instruction against it is load-bearing rather than decorative.
    expect(prompt).toMatch(/do not delete, skip, weaken or comment out/i)
  })

  it('stops when the attempts are spent, rather than going round again', async () => {
    await preferences.savePreferences({ repairAttempts: 2 })
    const s = await session()

    expect(await repair.planRepair(s.id, verdict('failing'))).not.toBeNull()
    expect(await repair.planRepair(s.id, verdict('failing'))).not.toBeNull()

    expect(await repair.planRepair(s.id, verdict('failing'))).toBeNull()
    const after = await sessions.findSession(s.id)
    expect(after?.repair?.state).toBe('gave-up')
    expect(after?.repair?.attempts).toBe(2)
  })

  it('keeps the ceiling a streak began with, so raising the setting cannot extend it', async () => {
    await preferences.savePreferences({ repairAttempts: 1 })
    const s = await session()
    await repair.planRepair(s.id, verdict('failing'))

    await preferences.savePreferences({ repairAttempts: 5 })
    expect(await repair.planRepair(s.id, verdict('failing'))).toBeNull()
    expect((await sessions.findSession(s.id))?.repair?.state).toBe('gave-up')
  })

  it('closes the streak when the checks come good', async () => {
    await preferences.savePreferences({ repairAttempts: 3 })
    const s = await session()
    await repair.planRepair(s.id, verdict('failing'))

    expect(await repair.planRepair(s.id, verdict('passing'))).toBeNull()
    expect((await sessions.findSession(s.id))?.repair?.state).toBe('fixed')
  })

  it('will not try to fix checks that could not run', async () => {
    await preferences.savePreferences({ repairAttempts: 3 })
    const s = await session()

    // `errored` is the suite failing to start — a missing dependency, a command
    // not on PATH. That says nothing about the code, so there is nothing here
    // to fix and spending a turn on it would be spending it on nothing.
    expect(await repair.planRepair(s.id, verdict('errored'))).toBeNull()
    expect((await sessions.findSession(s.id))?.repair).toBeUndefined()
  })

  it('does not act on a verdict that is not in yet', async () => {
    await preferences.savePreferences({ repairAttempts: 3 })
    const s = await session()
    expect(await repair.planRepair(s.id, verdict('running'))).toBeNull()
    expect(await repair.planRepair(s.id, null)).toBeNull()
  })

  it('says which attempt this is, so the agent does not repeat itself', async () => {
    await preferences.savePreferences({ repairAttempts: 3 })
    const s = await session()

    expect(await repair.planRepair(s.id, verdict('failing'))).not.toContain('attempt 2 of 3')
    expect(await repair.planRepair(s.id, verdict('failing'))).toContain('attempt 2 of 3')
  })
})

describe('beginManualRepair', () => {
  it('works with the preference off, because pressing the button is the choice', async () => {
    const s = await session({ check: verdict('failing') })

    const plan = await repair.beginManualRepair(s)

    expect(plan).toHaveProperty('input')
    expect((await sessions.findSession(s.id))?.repair).toMatchObject({
      attempts: 1, max: repair.DEFAULT_MANUAL_ATTEMPTS, state: 'running',
    })
  })

  it('starts a fresh streak over one that already gave up', async () => {
    const s = await session({
      check: verdict('failing'),
      repair: { attempts: 3, max: 3, state: 'gave-up', startedAt: 1, updatedAt: 1 },
    })

    await repair.beginManualRepair(s)
    expect((await sessions.findSession(s.id))?.repair).toMatchObject({ attempts: 1, state: 'running' })
  })

  it('refuses when there is nothing wrong, and says which nothing', async () => {
    const passing = await session({ check: verdict('passing') })
    expect(await repair.beginManualRepair(passing)).toMatchObject({ error: 'already_passing' })

    const errored = await session({ check: verdict('errored') })
    expect(await repair.beginManualRepair(errored)).toMatchObject({ error: 'checks_unrunnable' })

    const untested = await session()
    expect(await repair.beginManualRepair(untested)).toMatchObject({ error: 'no_verdict' })
  })
})

describe('clearRepair', () => {
  it('forgets a finished streak, so a new instruction starts clean', async () => {
    const s = await session({
      repair: { attempts: 2, max: 2, state: 'gave-up', startedAt: 1, updatedAt: 1 },
    })

    await repair.clearRepair(await sessions.findSession(s.id) as any)
    expect((await sessions.findSession(s.id))?.repair).toBeUndefined()
  })
})

describe('clampAttempts', () => {
  it('refuses to let a hand-edited file buy a hundred turns', () => {
    expect(preferences.clampAttempts(500)).toBe(preferences.MAX_REPAIR_ATTEMPTS)
    expect(preferences.clampAttempts(3)).toBe(3)
    expect(preferences.clampAttempts(0)).toBe(0)
    expect(preferences.clampAttempts(-2)).toBe(0)
    expect(preferences.clampAttempts('lots')).toBe(0)
    expect(preferences.clampAttempts(undefined)).toBe(0)
  })
})

describe('clampTurns', () => {
  it('treats 0 and nonsense as "no preference", not as a limit of zero', () => {
    // A limit of zero turns would mean every run stops before doing anything.
    expect(preferences.clampTurns(0)).toBe(0)
    expect(preferences.clampTurns(-5)).toBe(0)
    expect(preferences.clampTurns('lots')).toBe(0)
    expect(preferences.clampTurns(undefined)).toBe(0)
  })

  it('keeps a real number and caps it at what the SDK will take', () => {
    expect(preferences.clampTurns(120)).toBe(120)
    expect(preferences.clampTurns(5000)).toBe(preferences.MAX_TURNS_CEILING)
    expect(preferences.clampTurns(12.9)).toBe(12)
  })
})
