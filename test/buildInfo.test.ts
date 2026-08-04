import { describe, expect, it } from 'vitest'
import { describeBuild, type BuildStatus } from '../server/utils/buildInfo'

/**
 * The one thing this must never do is claim to be current when it is not —
 * that is the whole reason it exists, after an afternoon of wondering why a
 * fix that was definitely committed was definitely not there.
 */

const deployed = (patch: Partial<BuildStatus> = {}): BuildStatus => ({
  mode: 'deployed',
  sha: 'abc1234',
  behind: 0,
  stale: false,
  ...patch,
})

describe('saying which build is running', () => {
  it('stays quiet about a build that is current', () => {
    expect(describeBuild(deployed())).toBe('Running the current build')
  })

  it('counts how far behind it is', () => {
    expect(describeBuild(deployed({ behind: 1, stale: true }))).toBe('Build is 1 commit behind')
    expect(describeBuild(deployed({ behind: 7, stale: true }))).toBe('Build is 7 commits behind')
  })

  it('says so when the deployed commit is no longer in the repository', () => {
    // A rebase or a force-push leaves a build whose origin cannot be found;
    // reporting "current" there would be a lie.
    const status = deployed({ unknownCommit: true, stale: true })

    expect(describeBuild(status)).toMatch(/no longer has/)
  })

  it('has nothing to say when running from source', () => {
    // Working in the repository, the running code is whatever you last saved.
    expect(describeBuild({ mode: 'source', behind: 0, stale: false })).toBe('Running from source')
  })
})

describe('installed from npm', () => {
  /**
   * There is no repository behind an npm install, so there is nothing to be
   * behind. Reporting it as "running from source" told someone with no source
   * at all something that could not be true.
   */
  it('names the release rather than claiming to be source', () => {
    expect(describeBuild({ mode: 'package', version: '0.1.0', behind: 0, stale: false }))
      .toBe('Running agents-studio 0.1.0')
  })

  it('says something sensible without a version', () => {
    expect(describeBuild({ mode: 'package', behind: 0, stale: false }))
      .toBe('Running an installed release')
  })

  it('is never stale, because there is nothing to compare against', () => {
    const status: BuildStatus = { mode: 'package', version: '0.1.0', behind: 0, stale: false }
    expect(status.stale).toBe(false)
    expect(describeBuild(status)).not.toContain('behind')
  })
})
