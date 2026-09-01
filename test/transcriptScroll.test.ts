import { describe, expect, it } from 'vitest'
import { atEnd, PINNED_SLACK } from '~/utils/transcriptScroll'

/**
 * Whether the conversation is following the turn that is running.
 *
 * The two failures are mirror images and neither looks like a bug: written one
 * way, a transcript stops following a live turn and the page looks stalled;
 * written the other, it drags you back to the bottom while you are reading
 * something four turns up. So the comparison is pinned here rather than left in
 * a template.
 */
describe('atEnd', () => {
  const column = { scrollHeight: 2000, clientHeight: 500 }

  it('is true at the very end', () => {
    expect(atEnd({ ...column, scrollTop: 1500 })).toBe(true)
  })

  it('is true a nudge above it, because that is still following', () => {
    expect(atEnd({ ...column, scrollTop: 1500 - PINNED_SLACK })).toBe(true)
  })

  it('is false once somebody has scrolled up to read', () => {
    expect(atEnd({ ...column, scrollTop: 1500 - PINNED_SLACK - 1 })).toBe(false)
    expect(atEnd({ ...column, scrollTop: 0 })).toBe(false)
  })

  it('is true for a column with nothing to scroll', () => {
    // A short conversation never scrolls and never fires a scroll event, so the
    // first streamed token has to be followed on this answer alone.
    expect(atEnd({ scrollHeight: 400, scrollTop: 0, clientHeight: 400 })).toBe(true)
  })

  it('survives a fractional pixel ratio', () => {
    // `scrollHeight - scrollTop - clientHeight` lands on 0.5 at the visible end
    // on a fractional display. A strict comparison against zero would read that
    // as "not following".
    expect(atEnd({ scrollHeight: 2000.5, scrollTop: 1500, clientHeight: 500 })).toBe(true)
  })

  it('takes a tighter slack when asked', () => {
    expect(atEnd({ ...column, scrollTop: 1490 }, 4)).toBe(false)
    expect(atEnd({ ...column, scrollTop: 1497 }, 4)).toBe(true)
  })
})
