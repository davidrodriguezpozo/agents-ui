import { describe, expect, it, vi, afterEach } from 'vitest'
import { relativeTime, formatDuration, formatCost } from '../app/utils/time'

describe('relativeTime', () => {
  afterEach(() => vi.useRealTimers())

  function ago(seconds: number): number {
    return Date.now() - seconds * 1000
  }

  it('says "just now" for anything under a minute', () => {
    expect(relativeTime(ago(0))).toBe('just now')
    expect(relativeTime(ago(30))).toBe('just now')
    expect(relativeTime(ago(59))).toBe('just now')
  })

  it('shows minutes for under an hour', () => {
    expect(relativeTime(ago(60))).toBe('1m ago')
    expect(relativeTime(ago(300))).toBe('5m ago')
    expect(relativeTime(ago(3599))).toBe('59m ago')
  })

  it('shows hours for under a day', () => {
    expect(relativeTime(ago(3600))).toBe('1h ago')
    expect(relativeTime(ago(7200))).toBe('2h ago')
    expect(relativeTime(ago(86399))).toBe('23h ago')
  })

  it('shows a date for anything older than a day', () => {
    const result = relativeTime(ago(86400))
    // Should be a formatted date like "Aug 9", not a relative time
    expect(result).not.toContain('ago')
    expect(result).not.toBe('just now')
    expect(result).toMatch(/\w+ \d+/)
  })
})

describe('formatDuration', () => {
  it('returns null for falsy values', () => {
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(0)).toBeNull()
  })

  it('shows milliseconds below a second', () => {
    expect(formatDuration(1)).toBe('1ms')
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('shows seconds with one decimal below a minute', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(59999)).toBe('60.0s')
  })

  it('shows minutes for a minute or more', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(90_000)).toBe('2m')
    expect(formatDuration(300_000)).toBe('5m')
  })
})

describe('formatCost', () => {
  it('returns null for falsy values', () => {
    expect(formatCost(undefined)).toBeNull()
    expect(formatCost(0)).toBeNull()
  })

  it('shows sub-cent amounts as less than a penny', () => {
    expect(formatCost(0.001)).toBe('<$0.01')
    expect(formatCost(0.009)).toBe('<$0.01')
  })

  it('shows two decimals for a cent or more', () => {
    expect(formatCost(0.01)).toBe('$0.01')
    expect(formatCost(0.50)).toBe('$0.50')
    expect(formatCost(1.234)).toBe('$1.23')
    expect(formatCost(99.99)).toBe('$99.99')
  })
})
