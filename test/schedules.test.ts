import { describe, expect, it } from 'vitest'
import {
  computeNextRun,
  describeRecurrence,
  permissionModeFor,
} from '../server/utils/schedules'

/** Local time, so the assertions read the way a person would say them. */
function at(iso: string): Date {
  return new Date(iso)
}

function localTime(ts: number): string {
  const d = new Date(ts)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const WEEKDAYS = [1, 2, 3, 4, 5]

describe('computeNextRun', () => {
  it('fires later the same day when the time has not passed', () => {
    // Monday 07:00 -> 08:00 the same morning
    const next = computeNextRun({ hour: 8, minute: 0, days: WEEKDAYS }, at('2026-08-03T07:00:00'))
    expect(localTime(next)).toBe('Mon 08:00')
  })

  it('rolls to the next day once the time has passed', () => {
    const next = computeNextRun({ hour: 8, minute: 0, days: WEEKDAYS }, at('2026-08-03T09:00:00'))
    expect(localTime(next)).toBe('Tue 08:00')
  })

  it('skips the weekend for a weekday ritual', () => {
    // Friday after the hour -> Monday, not Saturday
    const next = computeNextRun({ hour: 8, minute: 0, days: WEEKDAYS }, at('2026-08-07T09:00:00'))
    expect(localTime(next)).toBe('Mon 08:00')
  })

  it('handles being asked on a day it never runs', () => {
    const next = computeNextRun({ hour: 8, minute: 0, days: WEEKDAYS }, at('2026-08-08T12:00:00'))
    expect(localTime(next)).toBe('Mon 08:00')
  })

  it('treats an empty day list as every day', () => {
    const next = computeNextRun({ hour: 6, minute: 30, days: [] }, at('2026-08-08T12:00:00'))
    expect(localTime(next)).toBe('Sun 06:30')
  })

  it('wraps a full week for a single-day ritual', () => {
    // Sunday-only, asked on Sunday after the time -> next Sunday
    const next = computeNextRun({ hour: 9, minute: 0, days: [0] }, at('2026-08-02T10:00:00'))
    expect(localTime(next)).toBe('Sun 09:00')
    expect(next - at('2026-08-02T10:00:00').getTime()).toBeGreaterThan(6 * 86_400_000)
  })

  it('never returns a time in the past', () => {
    const from = at('2026-08-03T23:59:00')
    const next = computeNextRun({ hour: 0, minute: 0, days: [] }, from)
    expect(next).toBeGreaterThan(from.getTime())
  })

  it('does not re-fire when asked exactly on the scheduled minute', () => {
    // The scheduler recomputes right after firing; returning "now" would loop.
    const from = at('2026-08-03T08:00:00')
    const next = computeNextRun({ hour: 8, minute: 0, days: WEEKDAYS }, from)
    expect(next).toBeGreaterThan(from.getTime())
    expect(localTime(next)).toBe('Tue 08:00')
  })

  it('crosses a month boundary', () => {
    const next = computeNextRun({ hour: 7, minute: 0, days: [] }, at('2026-08-31T22:00:00'))
    expect(new Date(next).getMonth()).toBe(8) // September
    expect(localTime(next)).toContain('07:00')
  })

  it('clamps out-of-range times rather than producing an invalid date', () => {
    const next = computeNextRun({ hour: 99, minute: 99, days: [] }, at('2026-08-03T07:00:00'))
    expect(Number.isNaN(next)).toBe(false)
    expect(next).toBeGreaterThan(at('2026-08-03T07:00:00').getTime())
  })
})

describe('describeRecurrence', () => {
  it('names the weekday case', () => {
    expect(describeRecurrence({ hour: 8, minute: 0, days: WEEKDAYS })).toBe('Weekdays at 08:00')
  })

  it('names the everyday case, however it is expressed', () => {
    expect(describeRecurrence({ hour: 9, minute: 30, days: [] })).toBe('Every day at 09:30')
    expect(describeRecurrence({ hour: 9, minute: 30, days: [0, 1, 2, 3, 4, 5, 6] }))
      .toBe('Every day at 09:30')
  })

  it('lists an arbitrary subset', () => {
    expect(describeRecurrence({ hour: 17, minute: 0, days: [1, 3] })).toBe('Mon, Wed at 17:00')
  })

  it('pads single-digit times', () => {
    expect(describeRecurrence({ hour: 7, minute: 5, days: [] })).toBe('Every day at 07:05')
  })
})

describe('permissionModeFor', () => {
  it('maps trust levels onto SDK permission modes', () => {
    expect(permissionModeFor('readonly')).toBe('plan')
    expect(permissionModeFor('edits')).toBe('acceptEdits')
    expect(permissionModeFor('full')).toBe('bypassPermissions')
  })

  it('does not decide what a legacy ritual runs as — the store does', () => {
    /*
     * This used to assert that an absent permission falls back to `acceptEdits`,
     * on the reasoning that rituals written before trust levels existed reach
     * this path. They do not: `scheduleStore` fills the field in on read, and the
     * shared fallback is now the *session* default, which is Auto.
     *
     * So the assertion moved to where the guarantee is — see
     * `ritualPermission.test.ts`, which reads a schedules.json with no permission
     * in it. What is worth pinning here is only that the two are different
     * answers, so a ritual can never quietly inherit the session one.
     */
    expect(permissionModeFor(undefined as never)).toBe('bypassPermissions')
    expect(permissionModeFor('edits')).not.toBe(permissionModeFor(undefined as never))
  })
})
