import { describe, expect, it } from 'vitest'
import { compactAge, matchesFilter, maxOffset, pad, toLines, toneForWorkStatus, truncate, windowAround, windowOf } from '../cli/format'
import { portFrom } from '../cli/connect'

describe('truncate', () => {
  it('fits, or ellipsises, and never exceeds width', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello world', 8)).toBe('hello w…')
    expect(truncate('ab', 1)).toBe('a')
    expect(truncate('ab', 0)).toBe('')
  })
})

describe('toLines', () => {
  it('wraps on a word boundary, and still breaks a word longer than the pane', () => {
    expect(toLines('one two three', 8)).toEqual(['one two', 'three'])
    expect(toLines('supercalifragilistic', 8)).toEqual(['supercal', 'ifragili', 'stic'])
    expect(toLines('a\n\nb', 8)).toEqual(['a', '', 'b'])
  })
})

describe('windowOf and windowAround', () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

  it('takes a slice from the bottom, which is where new output arrives', () => {
    expect(windowOf(items, 0, 3)).toEqual([7, 8, 9])
    expect(windowOf(items, 2, 3)).toEqual([5, 6, 7])
    expect(windowOf(items, 100, 3)).toEqual([0, 1, 2])
    expect(maxOffset(10, 3)).toBe(7)
    expect(maxOffset(2, 5)).toBe(0)
  })

  it('keeps the selected row on screen', () => {
    expect(windowAround(items, 0, 3)).toEqual([0, 1, 2])
    expect(windowAround(items, 9, 3)).toEqual([7, 8, 9])
    expect(windowAround(items, 5, 3)).toEqual([4, 5, 6])
  })
})

describe('pad', () => {
  it('pads to width after truncating', () => {
    expect(pad('ab', 4)).toBe('ab  ')
    expect(pad('ab', 4, 'right')).toBe('  ab')
    expect(pad('abcdef', 4)).toBe('abc…')
  })
})

describe('compactAge', () => {
  const now = Date.parse('2026-08-20T12:00:00Z')
  it('uses a short column shape', () => {
    expect(compactAge(now - 10_000, now)).toBe('now')
    expect(compactAge(now - 5 * 60_000, now)).toBe('5m')
    expect(compactAge(now - 3 * 3600_000, now)).toBe('3h')
  })
})

describe('matchesFilter', () => {
  it('is case-insensitive and empty matches everything', () => {
    expect(matchesFilter('Fix the Test', 'test')).toBe(true)
    expect(matchesFilter('Fix the Test', 'nope')).toBe(false)
    expect(matchesFilter('anything', '')).toBe(true)
  })
})

describe('toneForWorkStatus', () => {
  it('matches the browser: warning for needs-you, accent for yours', () => {
    expect(toneForWorkStatus('needs-you')).toBe('yellow')
    expect(toneForWorkStatus('yours')).toBe('cyan')
    expect(toneForWorkStatus('running')).toBe('cyan')
    expect(toneForWorkStatus('done')).toBe('green')
    expect(toneForWorkStatus('failed')).toBe('red')
  })
})

describe('portFrom', () => {
  it('prefers --port over PORT, and defaults to 3000', () => {
    expect(portFrom(['tui', '--port', '3001'], {})).toBe(3001)
    expect(portFrom(['--port=4000'], { PORT: '3001' })).toBe(4000)
    expect(portFrom(['-p', '9'], {})).toBe(9)
    expect(portFrom([], { PORT: '3002' })).toBe(3002)
    expect(portFrom([], {})).toBe(3000)
    expect(portFrom(['--port', 'nope'], {})).toBe(3000)
  })
})
