import { describe, expect, it } from 'vitest'
import { cleanSummary } from '../server/utils/sessionSummary'

describe('cleanSummary', () => {
  it('keeps a good sentence as it stands', () => {
    expect(cleanSummary('Added rate limiting to the upload endpoint.'))
      .toBe('Added rate limiting to the upload endpoint.')
  })

  it('drops a label the model added out of helpfulness', () => {
    expect(cleanSummary('Summary: Fixed the flaky upload test')).toBe('Fixed the flaky upload test')
    expect(cleanSummary('Answer — Fixed the flaky upload test')).toBe('Fixed the flaky upload test')
  })

  it('unwraps quotes', () => {
    expect(cleanSummary('"Fixed the flaky upload test"')).toBe('Fixed the flaky upload test')
    expect(cleanSummary('“Fixed the flaky upload test”')).toBe('Fixed the flaky upload test')
  })

  it('drops a leading bullet', () => {
    expect(cleanSummary('- Fixed the flaky upload test')).toBe('Fixed the flaky upload test')
    expect(cleanSummary('* Fixed the flaky upload test')).toBe('Fixed the flaky upload test')
  })

  it('takes only the first line when it rambles', () => {
    // A row has space for one sentence; the rest would be truncated anyway.
    const raw = 'Fixed the flaky upload test\n\nI also noticed the retry logic could be simplified.'
    expect(cleanSummary(raw)).toBe('Fixed the flaky upload test')
  })

  it('skips leading blank lines to the first real one', () => {
    expect(cleanSummary('\n\n  Fixed the upload test  \n')).toBe('Fixed the upload test')
  })

  it('caps a sentence that will not fit a row', () => {
    const long = `Rewrote ${'the very long thing '.repeat(20)}`
    const cleaned = cleanSummary(long)
    expect(cleaned.length).toBeLessThanOrEqual(161)
    expect(cleaned.endsWith('…')).toBe(true)
  })

  it('gives back nothing when the model said nothing usable', () => {
    // The caller treats empty as "no summary", which shows the row unchanged.
    expect(cleanSummary('')).toBe('')
    expect(cleanSummary('   \n  ')).toBe('')
    expect(cleanSummary('""')).toBe('')
  })
})
