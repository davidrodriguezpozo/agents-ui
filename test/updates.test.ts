import { afterEach, describe, expect, it, vi } from 'vitest'
import { isNewer, resetUpdateCache, updatePlan } from '../server/utils/updates'
import type { BuildStatus } from '../server/utils/buildInfo'

/**
 * Two failures matter here, and they are opposite.
 *
 * Nagging somebody who is already current is noise on a status line they cannot
 * dismiss. Telling somebody they are current when the check never completed is
 * worse — an offline machine would sit on a stale release believing it had
 * asked. So "do not know" has to stay distinct from "up to date".
 */

const base: BuildStatus = { mode: 'package', behind: 0, stale: false }

afterEach(() => {
  resetUpdateCache()
  vi.unstubAllGlobals()
})

/** The registry, answering however the test needs it to. */
function registry(answer: { version?: string } | 'fail') {
  vi.stubGlobal('fetch', async () => {
    if (answer === 'fail') throw new Error('offline')
    return { ok: true, json: async () => answer } as unknown as Response
  })
}

describe('comparing versions', () => {
  it('spots a newer one at each position', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('1.0.0', '0.9.9')).toBe(true)
    expect(isNewer('0.1.10', '0.1.9')).toBe(true)
  })

  it('is not fooled by string ordering', () => {
    // The whole reason this is not `>`: "0.1.10" < "0.1.9" as strings.
    expect(isNewer('0.1.9', '0.1.10')).toBe(false)
  })

  it('says no to the same version and to older ones', () => {
    expect(isNewer('0.1.9', '0.1.9')).toBe(false)
    expect(isNewer('0.1.8', '0.1.9')).toBe(false)
  })

  it('prefers a release to a prerelease of it', () => {
    expect(isNewer('0.2.0', '0.2.0-beta.1')).toBe(true)
    expect(isNewer('0.2.0-beta.1', '0.2.0')).toBe(false)
  })

  it('copes with a leading v and missing parts', () => {
    expect(isNewer('v0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('1.1', '1.0.9')).toBe(true)
  })
})

describe('an installed release', () => {
  it('offers the one command when there is something newer', async () => {
    registry({ version: '0.2.0' })

    const plan = await updatePlan({ ...base, version: '0.1.9' })

    expect(plan.available).toBe(true)
    expect(plan.command).toBe('npm install -g agents-studio@latest')
    expect(plan.canRun).toBe(true)
  })

  it('says nothing when it is already current', async () => {
    registry({ version: '0.1.9' })

    const plan = await updatePlan({ ...base, version: '0.1.9' })

    expect(plan.available).toBe(false)
    expect(plan.command).toBeNull()
  })

  it('does not claim to be current when the registry could not be reached', async () => {
    // The failure worth guarding: an offline machine told it is up to date
    // stops looking, and sits on an old release believing it asked.
    registry('fail')

    const plan = await updatePlan({ ...base, version: '0.1.9' })

    expect(plan.available).toBe(false)
    expect(plan.latest).toBeUndefined()
    expect(plan.note).toMatch(/could not reach/i)
  })

  it('asks the registry once and then remembers', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return { ok: true, json: async () => ({ version: '0.2.0' }) } as unknown as Response
    })

    await updatePlan({ ...base, version: '0.1.9' })
    await updatePlan({ ...base, version: '0.1.9' })

    expect(calls).toBe(1)
  })
})

describe('a checkout', () => {
  it('never tells somebody with a repository to run npm', async () => {
    const plan = await updatePlan({ ...base, mode: 'source' })

    expect(plan.command).toBeNull()
    expect(plan.canRun).toBe(false)
    expect(plan.note).toMatch(/checkout/i)
  })

  it('uses the commit count it already has rather than the network', async () => {
    registry('fail')

    const plan = await updatePlan({ ...base, mode: 'deployed', behind: 3, stale: true, sha: 'abcdef1234' })

    expect(plan.available).toBe(true)
    expect(plan.command).toBe('make service')
    // Not something a button should do on somebody's behalf.
    expect(plan.canRun).toBe(false)
    expect(plan.note).toContain('3 commits behind')
  })
})

describe('whether it could restart itself', () => {
  it('can when it was installed, since the service brings it back', async () => {
    registry({ version: '0.1.9' })

    const plan = await updatePlan({ ...base, version: '0.1.9', deployedAt: 1 })
    expect(plan.canRestart).toBe(true)
  })

  it('cannot when it was started in the foreground', async () => {
    registry({ version: '0.1.9' })

    const plan = await updatePlan({ ...base, version: '0.1.9' })
    expect(plan.canRestart).toBe(false)
  })
})
