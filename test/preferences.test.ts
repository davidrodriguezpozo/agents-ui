import { describe, expect, it } from 'vitest'
import {
  positiveOrZero,
  clampTurns,
  clampAttempts,
  sanitisePullActions,
  sanitiseIssueLabel,
  PULL_ACTION_INTENTS,
  MAX_REPAIR_ATTEMPTS,
  MAX_TURNS_CEILING,
  DEFAULT_ISSUE_LABEL,
} from '../server/utils/preferences'

describe('positiveOrZero', () => {
  it('passes through a positive number', () => {
    expect(positiveOrZero(5)).toBe(5)
    expect(positiveOrZero(0.01)).toBe(0.01)
    expect(positiveOrZero(1000)).toBe(1000)
  })

  it('returns 0 for zero', () => {
    expect(positiveOrZero(0)).toBe(0)
  })

  it('returns 0 for negative numbers', () => {
    expect(positiveOrZero(-1)).toBe(0)
    expect(positiveOrZero(-0.5)).toBe(0)
  })

  it('returns 0 for non-numbers', () => {
    expect(positiveOrZero('5')).toBe(0)
    expect(positiveOrZero(null)).toBe(0)
    expect(positiveOrZero(undefined)).toBe(0)
    expect(positiveOrZero(true)).toBe(0)
    expect(positiveOrZero({})).toBe(0)
  })

  it('returns 0 for Infinity and NaN', () => {
    expect(positiveOrZero(Infinity)).toBe(0)
    expect(positiveOrZero(-Infinity)).toBe(0)
    expect(positiveOrZero(NaN)).toBe(0)
  })
})

describe('clampTurns', () => {
  it('returns 0 for zero or missing — meaning use the default', () => {
    expect(clampTurns(0)).toBe(0)
    expect(clampTurns(undefined)).toBe(0)
    expect(clampTurns(null)).toBe(0)
    expect(clampTurns(-1)).toBe(0)
  })

  it('passes through a reasonable number', () => {
    expect(clampTurns(40)).toBe(40)
    expect(clampTurns(1)).toBe(1)
  })

  it('floors fractional turns', () => {
    expect(clampTurns(40.9)).toBe(40)
    expect(clampTurns(1.5)).toBe(1)
  })

  it('caps at the SDK ceiling', () => {
    expect(clampTurns(MAX_TURNS_CEILING)).toBe(MAX_TURNS_CEILING)
    expect(clampTurns(MAX_TURNS_CEILING + 1)).toBe(MAX_TURNS_CEILING)
    expect(clampTurns(9999)).toBe(MAX_TURNS_CEILING)
  })

  it('returns 0 for non-numbers', () => {
    expect(clampTurns('50')).toBe(0)
    expect(clampTurns(NaN)).toBe(0)
    expect(clampTurns(Infinity)).toBe(0)
  })
})

describe('clampAttempts', () => {
  it('returns 0 for zero or missing', () => {
    expect(clampAttempts(0)).toBe(0)
    expect(clampAttempts(undefined)).toBe(0)
    expect(clampAttempts(-1)).toBe(0)
  })

  it('passes through a reasonable number', () => {
    expect(clampAttempts(3)).toBe(3)
    expect(clampAttempts(1)).toBe(1)
  })

  it('floors fractional attempts', () => {
    expect(clampAttempts(3.7)).toBe(3)
  })

  it('caps at MAX_REPAIR_ATTEMPTS', () => {
    expect(clampAttempts(MAX_REPAIR_ATTEMPTS)).toBe(MAX_REPAIR_ATTEMPTS)
    expect(clampAttempts(MAX_REPAIR_ATTEMPTS + 1)).toBe(MAX_REPAIR_ATTEMPTS)
    expect(clampAttempts(500)).toBe(MAX_REPAIR_ATTEMPTS)
  })

  it('returns 0 for non-numbers', () => {
    expect(clampAttempts('3')).toBe(0)
    expect(clampAttempts(NaN)).toBe(0)
  })
})

/**
 * The stored map reaches the code that builds a turn, so a hand-edited or
 * pre-existing file must not put a missing key or a non-string where a command
 * is expected. Every key present, every value a trimmed string.
 */
describe('sanitisePullActions', () => {
  it('fills every intent with an empty string when given nothing', () => {
    expect(sanitisePullActions(undefined)).toEqual({ review: '', address: '', fix: '', update: '' })
    expect(sanitisePullActions(null)).toEqual({ review: '', address: '', fix: '', update: '' })
    expect(sanitisePullActions({})).toEqual({ review: '', address: '', fix: '', update: '' })
  })

  it('keeps and trims string commands', () => {
    expect(sanitisePullActions({ review: '  /hd:review {url}  ', fix: '/hd:fix' }))
      .toEqual({ review: '/hd:review {url}', address: '', fix: '/hd:fix', update: '' })
  })

  it('drops non-string values to empty', () => {
    expect(sanitisePullActions({ review: 5, address: {}, fix: null, update: true }))
      .toEqual({ review: '', address: '', fix: '', update: '' })
  })

  it('ignores keys that are not real intents', () => {
    const clean = sanitisePullActions({ review: '/x', bogus: '/y' } as Record<string, unknown>)
    expect(Object.keys(clean).sort()).toEqual([...PULL_ACTION_INTENTS].sort())
    expect('bogus' in clean).toBe(false)
  })
})

describe('sanitiseIssueLabel', () => {
  it('trims what was typed', () => {
    expect(sanitiseIssueLabel('  studio  ')).toBe('studio')
  })

  it('keeps an empty label, which is how the label half is turned off', () => {
    // Not a missing value falling back to the default: somebody chose to watch
    // no label, and reading it back as `studio` would make that unturnoffable.
    expect(sanitiseIssueLabel('')).toBe('')
    expect(sanitiseIssueLabel('   ')).toBe('')
  })

  it('falls back to the default only when it is not a string at all', () => {
    expect(sanitiseIssueLabel(undefined)).toBe(DEFAULT_ISSUE_LABEL)
    expect(sanitiseIssueLabel(42)).toBe(DEFAULT_ISSUE_LABEL)
  })

  it('caps a hand-edited file at GitHub\'s own label length', () => {
    expect(sanitiseIssueLabel('x'.repeat(200))).toHaveLength(50)
  })
})
