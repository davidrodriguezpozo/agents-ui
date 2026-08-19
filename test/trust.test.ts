import { describe, expect, it } from 'vitest'
import { asksNothing, permissionModeFor, DEFAULT_TRUST } from '../server/utils/trust'

/**
 * This decides whether an agent stops to ask before running a command, so the
 * mapping is worth pinning down in both directions.
 *
 * **The default changed, deliberately.** It used to be `edits`, and the test
 * below used to assert that silence "must never read as full trust". That was
 * the right guard while silence was mostly *legacy* — records written before the
 * setting existed. It is now mostly a session nobody was asked about: one
 * started from a pull request row, from the Fleet screen, from a batch. Those all
 * live in their own worktree, which is the argument for Auto being what they run
 * as, and the sandbox rather than a prompt is what still stands in their way.
 *
 * What has *not* changed, and is now the property carrying the safety: an
 * unattended ritual never reaches this fallback, because a schedule always
 * carries an explicit permission. That is asserted in `ritualPermission.test.ts`
 * rather than left as a comment, since it is the thing that would quietly stop
 * being true.
 */

describe('mapping trust onto what the SDK is told', () => {
  it('plans rather than acts at the lowest level', () => {
    expect(permissionModeFor('readonly')).toBe('plan')
  })

  it('writes files but stops at anything riskier when that is what was chosen', () => {
    expect(permissionModeFor('edits')).toBe('acceptEdits')
  })

  it('asks for nothing at full trust', () => {
    expect(permissionModeFor('full')).toBe('bypassPermissions')
  })

  it('reads an absent level as the default, which is Auto', () => {
    expect(permissionModeFor(undefined)).toBe('bypassPermissions')
    expect(DEFAULT_TRUST).toBe('full')
    // Through the constant, so the two cannot drift apart: the page shows the
    // default and the run obeys it, and a session whose control says Auto must
    // not be asking questions.
    expect(permissionModeFor(undefined)).toBe(permissionModeFor(DEFAULT_TRUST))
  })

  it('still honours a level that was chosen over the default', () => {
    // The half of the old guard that must survive: a default this permissive is
    // only safe while saying "ask me" is respected.
    expect(permissionModeFor('edits')).not.toBe(permissionModeFor(undefined))
    expect(permissionModeFor('readonly')).not.toBe(permissionModeFor(undefined))
  })
})

describe('knowing when nothing will be asked', () => {
  it('is true at full trust and at the default that means it', () => {
    expect(asksNothing('full')).toBe(true)
    expect(asksNothing(undefined)).toBe(true)
  })

  it('is false wherever something was chosen that asks', () => {
    expect(asksNothing('edits')).toBe(false)
    expect(asksNothing('readonly')).toBe(false)
  })
})
