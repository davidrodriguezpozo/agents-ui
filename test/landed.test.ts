import { describe, expect, it } from 'vitest'
import { describeLanded, landedSince, type SessionLanded } from '../server/utils/landed'

/**
 * What shipped.
 *
 * The field exists because three different things put a session's work in, and a
 * `mergedAt` written by only one of them would have been worse than nothing: a
 * session that landed by another route would have read as one that never landed.
 * So the tests are mostly about telling the three apart.
 */

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

describe('describeLanded', () => {
  it('names the branch it went into, because "landed" alone is half a fact', () => {
    expect(describeLanded({ at: NOW, how: 'merged', into: 'main' })).toBe('merged into main')
  })

  /**
   * A decision somebody made with reasons, and the question "was this known to
   * be broken when it landed" deserves an answer six months later.
   */
  it('keeps a merge that went in over a failing check', () => {
    expect(describeLanded({ at: NOW, how: 'merged', into: 'main', overrodeChecks: true }))
      .toBe('merged into main, over a failing check')
  })

  it('says when this app merged a green pull request', () => {
    expect(describeLanded({ at: NOW, how: 'pull-request', pr: 42 }))
      .toBe('#42 passed CI and was merged')
  })

  /**
   * The case the whole `how` field exists for. "It is in" and "we put it in" are
   * different facts, and only one of them is this app taking credit.
   */
  it('does not claim a merge somebody else did on github.com', () => {
    expect(describeLanded({ at: NOW, how: 'elsewhere', pr: 7 }))
      .toBe('#7 was merged on GitHub — not by this machine')
    expect(describeLanded({ at: NOW, how: 'elsewhere' }))
      .toBe('merged somewhere else, not by this machine')
  })

  it('says something useful with nothing but the route', () => {
    expect(describeLanded({ at: NOW, how: 'merged' })).toBe('merged')
  })
})

describe('landedSince', () => {
  const sessions = [
    { id: 'old', landed: { at: NOW - 5 * DAY, how: 'merged' } as SessionLanded },
    { id: 'yesterday', landed: { at: NOW - DAY, how: 'merged' } as SessionLanded },
    { id: 'open' },
    { id: 'today', landed: { at: NOW - 60_000, how: 'pull-request' } as SessionLanded },
  ]

  it('returns what landed inside the window, newest first', () => {
    expect(landedSince(sessions, NOW - 2 * DAY).map(s => s.id)).toEqual(['today', 'yesterday'])
  })

  it('leaves out what never landed', () => {
    expect(landedSince(sessions, 0).map(s => s.id)).not.toContain('open')
  })

  it('is empty when nothing has shipped', () => {
    expect(landedSince([{ id: 'a' } as { id: string; landed?: SessionLanded }], 0)).toEqual([])
  })
})
