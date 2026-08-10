import { describe, expect, it } from 'vitest'
import { toSdkModel } from '../server/utils/resolveAgent'

/**
 * `normalizeTools` is not exported, so it is tested indirectly through the
 * frontmatter round-trip in other suites. `toSdkModel` is the only pure
 * export here.
 */

describe('toSdkModel', () => {
  it('returns undefined for "inherit"', () => {
    expect(toSdkModel('inherit')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(toSdkModel('')).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(toSdkModel(undefined)).toBeUndefined()
  })

  it('passes through a real model name', () => {
    expect(toSdkModel('opus')).toBe('opus')
    expect(toSdkModel('sonnet')).toBe('sonnet')
    expect(toSdkModel('haiku')).toBe('haiku')
  })

  it('passes through any other string', () => {
    expect(toSdkModel('claude-3-opus-20240229')).toBe('claude-3-opus-20240229')
  })
})
