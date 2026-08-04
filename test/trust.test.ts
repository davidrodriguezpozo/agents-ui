import { describe, expect, it } from 'vitest'
import { asksNothing, permissionModeFor, DEFAULT_TRUST } from '../server/utils/trust'

/**
 * This decides whether an agent stops to ask before running a command. Getting
 * it wrong in the permissive direction means something ran that nobody
 * approved, so the mapping is worth pinning down.
 */

describe('mapping trust onto what the SDK is told', () => {
  it('plans rather than acts at the lowest level', () => {
    expect(permissionModeFor('readonly')).toBe('plan')
  })

  it('writes files but stops at anything riskier by default', () => {
    expect(permissionModeFor('edits')).toBe('acceptEdits')
    expect(permissionModeFor(DEFAULT_TRUST)).toBe('acceptEdits')
  })

  it('asks for nothing only when explicitly told to', () => {
    expect(permissionModeFor('full')).toBe('bypassPermissions')
  })

  it('treats an absent level as the cautious default, never as full trust', () => {
    // Sessions written before this setting existed have no value at all, and
    // reading that as "anything it needs" would be the worst possible guess.
    expect(permissionModeFor(undefined)).toBe('acceptEdits')
  })
})

describe('knowing when nothing will be asked', () => {
  it('is true only at full trust', () => {
    expect(asksNothing('full')).toBe(true)
    expect(asksNothing('edits')).toBe(false)
    expect(asksNothing('readonly')).toBe(false)
    expect(asksNothing(undefined)).toBe(false)
  })
})
