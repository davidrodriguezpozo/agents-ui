import { describe, expect, it } from 'vitest'
import {
  describeRule,
  formatRule,
  mergeRules,
  parseRule,
  removeRule,
  rulesFromSuggestions,
  toSettingsPermissions,
} from '../server/utils/permissionRules'

describe('formatRule / parseRule', () => {
  it('renders a bare tool', () => {
    expect(formatRule({ toolName: 'Read' })).toBe('Read')
  })

  it('renders a narrowed tool', () => {
    expect(formatRule({ toolName: 'Bash', ruleContent: 'gh:*' })).toBe('Bash(gh:*)')
  })

  it('ignores empty rule content rather than emitting Tool()', () => {
    expect(formatRule({ toolName: 'Bash', ruleContent: '   ' })).toBe('Bash')
  })

  it('returns empty for a missing tool name', () => {
    expect(formatRule({ toolName: '' })).toBe('')
  })

  it('round-trips', () => {
    for (const rule of ['Read', 'Bash(gh:*)', 'WebFetch(domain:github.com)']) {
      expect(formatRule(parseRule(rule)!)).toBe(rule)
    }
  })

  it('parses content containing parentheses', () => {
    expect(parseRule('Bash(echo (hi))')).toEqual({ toolName: 'Bash', ruleContent: 'echo (hi)' })
  })

  it('rejects nonsense', () => {
    expect(parseRule('')).toBeNull()
    expect(parseRule('   ')).toBeNull()
    expect(parseRule('(no tool)')).toBeNull()
  })
})

describe('rulesFromSuggestions', () => {
  it('takes allow rules the CLI proposed', () => {
    expect(rulesFromSuggestions([
      { type: 'addRules', behavior: 'allow', rules: [{ toolName: 'Bash', ruleContent: 'gh:*' }], destination: 'session' },
    ] as never)).toEqual(['Bash(gh:*)'])
  })

  it('ignores deny suggestions', () => {
    // Accepting these would invert the meaning of the allowlist.
    expect(rulesFromSuggestions([
      { type: 'addRules', behavior: 'deny', rules: [{ toolName: 'Bash' }], destination: 'session' },
    ] as never)).toEqual([])
  })

  it('ignores updates that are not rule changes', () => {
    expect(rulesFromSuggestions([
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      { type: 'addDirectories', directories: ['/tmp'], destination: 'session' },
    ] as never)).toEqual([])
  })

  it('dedupes across several suggestions', () => {
    expect(rulesFromSuggestions([
      { type: 'addRules', behavior: 'allow', rules: [{ toolName: 'Read' }], destination: 'session' },
      { type: 'replaceRules', behavior: 'allow', rules: [{ toolName: 'Read' }], destination: 'session' },
    ] as never)).toEqual(['Read'])
  })

  it('handles nothing at all', () => {
    expect(rulesFromSuggestions(undefined)).toEqual([])
    expect(rulesFromSuggestions([])).toEqual([])
  })
})

describe('mergeRules', () => {
  it('combines and sorts', () => {
    expect(mergeRules(['Read'], ['Bash(gh:*)'])).toEqual(['Bash(gh:*)', 'Read'])
  })

  it('dedupes across runs', () => {
    // The same ritual asking twice must not accumulate duplicates.
    expect(mergeRules(['Bash(gh:*)'], ['Bash(gh:*)'])).toEqual(['Bash(gh:*)'])
  })

  it('drops a narrowed rule once the bare tool is allowed', () => {
    // Keeping both would misrepresent how narrow the permissions are.
    expect(mergeRules(['Bash'], ['Bash(gh:*)'])).toEqual(['Bash'])
    expect(mergeRules(['Bash(gh:*)'], ['Bash'])).toEqual(['Bash'])
  })

  it('keeps narrowed rules for different tools', () => {
    expect(mergeRules(['Bash'], ['WebFetch(domain:github.com)']))
      .toEqual(['Bash', 'WebFetch(domain:github.com)'])
  })

  it('keeps several narrowings of the same tool', () => {
    expect(mergeRules(['Bash(gh:*)'], ['Bash(git:*)'])).toEqual(['Bash(gh:*)', 'Bash(git:*)'])
  })

  it('survives empty and malformed input', () => {
    expect(mergeRules()).toEqual([])
    expect(mergeRules([], [])).toEqual([])
    expect(mergeRules(['  '], ['Read'])).toEqual(['Read'])
  })
})

describe('removeRule', () => {
  it('removes exactly one rule', () => {
    expect(removeRule(['Bash(gh:*)', 'Read'], 'Read')).toEqual(['Bash(gh:*)'])
  })

  it('is unbothered by a rule that is not there', () => {
    expect(removeRule(['Read'], 'Bash')).toEqual(['Read'])
  })
})

describe('describeRule', () => {
  it('explains bare tools in plain language', () => {
    expect(describeRule('Bash')).toBe('Run any terminal command')
    expect(describeRule('Read')).toBe('Read any file')
  })

  it('explains narrowed tools', () => {
    expect(describeRule('Bash(gh:*)')).toBe('Run gh:* commands')
    expect(describeRule('WebFetch(domain:github.com)')).toBe('Fetch pages from github.com')
  })

  it('falls back readably for tools it does not know', () => {
    expect(describeRule('mcp__notion__fetch')).toBe('Use mcp__notion__fetch')
  })
})

describe('toSettingsPermissions', () => {
  it('shapes an allowlist for the SDK', () => {
    expect(toSettingsPermissions(['Read', 'Bash(gh:*)']))
      .toEqual({ permissions: { allow: ['Bash(gh:*)', 'Read'] } })
  })

  it('returns undefined when there is nothing to allow', () => {
    // An empty settings object would still override, so send nothing.
    expect(toSettingsPermissions([])).toBeUndefined()
    expect(toSettingsPermissions(undefined)).toBeUndefined()
  })
})
