import { describe, expect, it } from 'vitest'
import { keysPath, readOverrides } from '../keys'

describe('keysPath', () => {
  it('sits beside everything else this app keeps', () => {
    expect(keysPath({ HOME: '/home/me' })).toBe('/home/me/.claude/agents-studio/keys.json')
    // The same override the rest of the app honours, so a test run cannot read
    // the real one.
    expect(keysPath({ CLAUDE_DIR: '/tmp/claude' })).toBe('/tmp/claude/agents-studio/keys.json')
  })
})

describe('readOverrides', () => {
  it('takes id-to-key pairs and nothing else', () => {
    expect(readOverrides('{"session.checks": "C", "refresh": "ctrl+r"}')).toEqual({
      'session.checks': 'C',
      refresh: 'ctrl+r',
    })
  })

  it('drops entries that are not keys', () => {
    expect(readOverrides('{"a": 3, "b": null, "c": "", "d": "  ", "e": "x"}')).toEqual({ e: 'x' })
  })

  it('refuses a file that is not a mapping', () => {
    expect(() => readOverrides('[]')).toThrow(/object of binding ids/)
    expect(() => readOverrides('"nope"')).toThrow(/object of binding ids/)
    expect(() => readOverrides('{')).toThrow()
  })
})
