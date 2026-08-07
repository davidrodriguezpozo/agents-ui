import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * The payload this reads was captured from a real `rate_limit_event`, and it
 * disagreed with the obvious assumptions twice:
 *
 *   {"status":"allowed","resetsAt":1786103400,"rateLimitType":"five_hour",
 *    "overageStatus":"rejected","isUsingOverage":false}
 *
 * `utilization` is absent — so a limit expressed as a percentage of the week
 * would have had nothing to read — and `resetsAt` is in *seconds*, ten digits
 * where the rest of this codebase uses thirteen.
 */

let dir: string
let quota: typeof import('../server/utils/quota')

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-quota-'))
  process.env.CLAUDE_DIR = dir
  quota = await import('../server/utils/quota')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
})

const REAL_EVENT = {
  status: 'allowed',
  resetsAt: 1786103400,
  rateLimitType: 'five_hour',
  overageStatus: 'rejected',
  isUsingOverage: false,
}

describe('reading what the SDK sent', () => {
  it('keeps the real payload, absent utilization and all', async () => {
    await quota.recordQuota(REAL_EVENT, 1_000)

    await expect(quota.readQuota()).resolves.toEqual({
      status: 'allowed',
      resetsAt: 1786103400,
      rateLimitType: 'five_hour',
      utilization: undefined,
      observedAt: 1_000,
    })
  })

  it('reads resetsAt as seconds, not milliseconds', () => {
    // The difference between "resets this afternoon" and "resets in 1970".
    expect(quota.resetsAtMs({ resetsAt: 1786103400 })).toBe(1786103400000)
    expect(quota.resetsAtMs({ resetsAt: undefined })).toBeUndefined()
  })

  it('ignores a status it does not understand rather than storing nonsense', async () => {
    await quota.recordQuota({ status: 'something_new' }, 1_000)
    await expect(quota.readQuota()).resolves.toBeNull()
  })

  it('answers "do not know" when nothing has been heard', async () => {
    await expect(quota.readQuota()).resolves.toBeNull()
  })
})

describe('whether unattended work should wait', () => {
  const info = (patch = {}) => ({ status: 'allowed' as const, observedAt: 1_000, ...patch })

  it('lets work through when there is room', () => {
    expect(quota.quotaBlocks(info(), 1_000)).toBe(false)
  })

  it('holds work back on a warning, before the refusal rather than after', () => {
    expect(quota.quotaBlocks(info({ status: 'allowed_warning' }), 1_000)).toBe(true)
  })

  it('holds work back once the limit is used up', () => {
    expect(quota.quotaBlocks(info({ status: 'rejected' }), 1_000)).toBe(true)
  })

  it('does not act on a reading old enough to be wrong', () => {
    // A five-hour window turns over completely in six hours, so an old warning
    // would keep skipping rituals long after the limit had reset.
    const old = info({ status: 'rejected' })
    expect(quota.quotaBlocks(old, 1_000 + quota.QUOTA_STALE_AFTER_MS + 1)).toBe(false)
  })

  it('does not block when nothing is known', () => {
    // Failing open: never having heard must not stop the machine.
    expect(quota.quotaBlocks(null, 1_000)).toBe(false)
  })
})

describe('saying it in words', () => {
  it('names the window and when it comes back', () => {
    const said = quota.quotaReason({
      status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1786103400, observedAt: 1,
    })
    expect(said).toContain('weekly')
    expect(said).toContain('used up')
  })

  it('distinguishes being close from being out', () => {
    const close = quota.quotaReason({ status: 'allowed_warning', observedAt: 1 })
    expect(close).toContain('close to')
    expect(close).not.toContain('used up')
  })

  it('says something sensible about a window it has no name for', () => {
    expect(quota.describeWindow(undefined)).toBe('usage')
  })
})
