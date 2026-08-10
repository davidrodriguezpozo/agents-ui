import { describe, expect, it } from 'vitest'
import { getFriendlyModelName, getFriendlyToolName, friendlyModelName, friendlyToolName } from '../app/utils/terminology'

describe('getFriendlyModelName', () => {
  it('returns the right label for each known model', () => {
    expect(getFriendlyModelName('opus')).toBe('Most capable')
    expect(getFriendlyModelName('sonnet')).toBe('Balanced')
    expect(getFriendlyModelName('haiku')).toBe('Fast & efficient')
    expect(getFriendlyModelName('inherit')).toBe('Same as the session')
  })

  it('defaults to Balanced when undefined', () => {
    expect(getFriendlyModelName(undefined)).toBe('Balanced')
  })

  it('passes through an unknown model name as-is', () => {
    expect(getFriendlyModelName('future-model' as any)).toBe('future-model')
  })
})

describe('getFriendlyToolName', () => {
  it('returns a human label for each known tool', () => {
    for (const [tool, label] of Object.entries(friendlyToolName)) {
      expect(getFriendlyToolName(tool)).toBe(label)
    }
  })

  it('falls back to "Working..." for unknown tools', () => {
    expect(getFriendlyToolName('UnknownTool')).toBe('Working...')
    expect(getFriendlyToolName('')).toBe('Working...')
  })
})
