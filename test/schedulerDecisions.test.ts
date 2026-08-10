import { describe, expect, it } from 'vitest'
import { dueVerdict, describeLateness, latePrompt, lateTitle } from '../server/utils/scheduler'

/** The catch-up window is 2 hours. */
const TWO_HOURS = 2 * 60 * 60 * 1000

describe('dueVerdict', () => {
  const now = Date.now()

  it('waits when there is no nextRunAt', () => {
    expect(dueVerdict(undefined, now)).toBe('wait')
  })

  it('waits when the next run is in the future', () => {
    expect(dueVerdict(now + 60_000, now)).toBe('wait')
  })

  it('fires when the run is due right now', () => {
    expect(dueVerdict(now, now)).toBe('fire')
  })

  it('fires when the run is slightly overdue', () => {
    expect(dueVerdict(now - 60_000, now)).toBe('fire')
  })

  it('fires up to the edge of the catch-up window', () => {
    expect(dueVerdict(now - TWO_HOURS, now)).toBe('fire')
  })

  it('misses when past the window without catchUp', () => {
    expect(dueVerdict(now - TWO_HOURS - 1, now)).toBe('missed')
  })

  it('returns late when past the window with catchUp', () => {
    expect(dueVerdict(now - TWO_HOURS - 1, now, true)).toBe('late')
  })

  it('misses far-overdue runs without catchUp', () => {
    expect(dueVerdict(now - 24 * 60 * 60 * 1000, now)).toBe('missed')
  })

  it('returns late for far-overdue runs with catchUp', () => {
    expect(dueVerdict(now - 24 * 60 * 60 * 1000, now, true)).toBe('late')
  })
})

describe('describeLateness', () => {
  const HOUR = 60 * 60_000

  it('says less than an hour for short delays', () => {
    // Math.round(20min / 60min) = 0 → less than an hour
    expect(describeLateness(20 * 60_000)).toBe('less than an hour')
  })

  it('says 1 hour singular', () => {
    expect(describeLateness(HOUR)).toBe('1 hour')
  })

  it('says N hours plural', () => {
    expect(describeLateness(3 * HOUR)).toBe('3 hours')
  })

  it('switches to days after 47 hours', () => {
    expect(describeLateness(47 * HOUR)).toBe('47 hours')
    expect(describeLateness(48 * HOUR)).toBe('2 days')
  })

  it('rounds to the nearest day', () => {
    expect(describeLateness(72 * HOUR)).toBe('3 days')
  })
})

describe('latePrompt', () => {
  it('appends a lateness notice to the original input', () => {
    const result = latePrompt('Do the morning briefing.', 3 * 60 * 60_000)
    expect(result).toContain('Do the morning briefing.')
    expect(result).toContain('This run is late')
    expect(result).toContain('3 hours ago')
  })

  it('preserves the original prompt verbatim', () => {
    const input = 'Check what came in overnight.'
    const result = latePrompt(input, 60 * 60_000)
    expect(result.startsWith(input)).toBe(true)
  })
})

describe('lateTitle', () => {
  it('appends lateness to the title', () => {
    expect(lateTitle('Morning briefing', 3 * 60 * 60_000)).toBe('Morning briefing · 3 hours late')
  })

  it('uses singular hour', () => {
    expect(lateTitle('Triage', 60 * 60_000)).toBe('Triage · 1 hour late')
  })
})
