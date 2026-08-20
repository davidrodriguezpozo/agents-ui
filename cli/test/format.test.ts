import { describe, expect, it } from 'vitest'
import { compactAge, matchesFilter, maxOffset, pad, plain, toLines, toneForWorkStatus, truncate, windowAround, windowOf } from '../format'

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

describe('plain', () => {
  it('turns a carriage return into the newline it was standing in for', () => {
    // The bug this exists for: a `\r` in a session's text snaps the terminal to
    // column 0 mid-row, and everything after it overwrites the pane to its left.
    expect(plain('one\rtwo')).toBe('one\ntwo')
    expect(plain('one\r\ntwo')).toBe('one\ntwo')
  })

  it('drops somebody else\u2019s colours and cursor moves', () => {
    expect(plain('\x1b[31mred\x1b[0m')).toBe('red')
    expect(plain('up\x1b[2Aand\x1b[Kback')).toBe('upandback')
    expect(plain('\x1b]0;a new window title\x07here')).toBe('here')
  })

  it('drops the other control characters and keeps the text', () => {
    expect(plain('a\x00b\x7fc\x08d')).toBe('abcd')
    expect(plain('tabs\tsurvive')).toBe('tabs\tsurvive')
    expect(plain('plain text')).toBe('plain text')
  })
})

describe('wrapping text that came off the wire', () => {
  it('wraps a long line that contains a carriage return, and keeps none of it', () => {
    const text = `${'a'.repeat(40)}\r${'b'.repeat(40)}`
    const lines = toLines(text, 20)
    expect(lines.every(line => !line.includes('\r'))).toBe(true)
    expect(lines.every(line => line.length <= 20)).toBe(true)
    // The `\r` became a break, so the two runs do not end up on one line.
    expect(lines).toContain('a'.repeat(20))
  })

  it('never lets an escape sequence through a truncation', () => {
    expect(truncate('\x1b[31mred alert\x1b[0m', 8)).toBe('red ale…')
  })
})
