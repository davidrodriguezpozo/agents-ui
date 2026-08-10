import { describe, expect, it } from 'vitest'
import { getAgentColor, agentColorMap, modelColors } from '../app/utils/colors'

describe('getAgentColor', () => {
  it('returns the hex for each named color', () => {
    for (const [name, hex] of Object.entries(agentColorMap)) {
      expect(getAgentColor(name)).toBe(hex)
    }
  })

  it('returns fallback grey for an unknown color', () => {
    expect(getAgentColor('chartreuse')).toBe('#71717a')
  })

  it('returns fallback grey for undefined', () => {
    expect(getAgentColor(undefined)).toBe('#71717a')
  })

  it('returns fallback grey for empty string', () => {
    expect(getAgentColor('')).toBe('#71717a')
  })
})

describe('modelColors', () => {
  it('has entries for opus, sonnet, and haiku', () => {
    expect(modelColors.opus).toBeDefined()
    expect(modelColors.sonnet).toBeDefined()
    expect(modelColors.haiku).toBeDefined()
  })

  it('each entry has bg, text, and label', () => {
    for (const entry of Object.values(modelColors)) {
      expect(entry).toHaveProperty('bg')
      expect(entry).toHaveProperty('text')
      expect(entry).toHaveProperty('label')
    }
  })
})
