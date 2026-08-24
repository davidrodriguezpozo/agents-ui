import { describe, expect, it } from 'vitest'
import { asProviderId, capabilitiesOf, providerFor, PROVIDER_IDS } from '../../server/utils/providers'

/**
 * The reading of a record's `provider` field, which is the whole of the
 * migration: there isn't one.
 */
describe('which provider a record belongs to', () => {
  /**
   * Every session, run and schedule already on disk was written before the
   * field existed, and every one of them ran on Claude Code. So absence already
   * carries the answer, and rewriting live session files to say what they imply
   * would be risk bought for nothing.
   */
  it('runs a record with no provider as Claude Code', () => {
    expect(providerFor(undefined).id).toBe('claude')
    expect(providerFor(null).id).toBe('claude')
    expect(providerFor('').id).toBe('claude')
  })

  it('gives such a record every capability Claude Code has', () => {
    expect(capabilitiesOf(undefined)).toEqual({
      canSteer: true,
      canPromptForPermission: true,
      reportsCostUsd: true,
    })
  })

  it('runs a record that names one through that one', () => {
    expect(providerFor('cursor').id).toBe('cursor')
    expect(providerFor('claude').id).toBe('claude')
  })

  /**
   * A record naming a provider this build no longer has is better read as the
   * original than as a crash: the session still has a worktree, a branch and a
   * history somebody wants back.
   */
  it('reads an unrecognised provider as Claude Code rather than failing', () => {
    expect(providerFor('codex').id).toBe('claude')
    expect(providerFor('nonsense').id).toBe('claude')
  })

  it('accepts only a provider it has from a request body', () => {
    expect(asProviderId('cursor')).toBe('cursor')
    expect(asProviderId('codex')).toBeUndefined()
    expect(asProviderId(undefined)).toBeUndefined()
    expect(asProviderId(7)).toBeUndefined()
  })
})

describe('what each provider says it can do', () => {
  it('answers for every provider it lists, so the UI never has to guess', () => {
    for (const id of PROVIDER_IDS) {
      const provider = providerFor(id)
      expect(provider.id).toBe(id)
      expect(provider.label).toBeTruthy()
      expect(typeof provider.capabilities.canSteer).toBe('boolean')
      expect(typeof provider.capabilities.canPromptForPermission).toBe('boolean')
      expect(typeof provider.capabilities.reportsCostUsd).toBe('boolean')
    }
  })

  /**
   * The three that do not port, stated as values rather than as comments. Each
   * has to be readable before the first turn — a composer offering Steer on a
   * provider with no open stdin is a button that silently does something else.
   */
  it('is honest about the three things Cursor cannot do', () => {
    expect(capabilitiesOf('cursor')).toEqual({
      canSteer: false,
      canPromptForPermission: false,
      reportsCostUsd: false,
    })
  })
})
