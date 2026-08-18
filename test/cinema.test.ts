import { describe, expect, it } from 'vitest'
import {
  ACTS,
  actById,
  actsFor,
  isDue,
  nextAct,
  prevAct,
  progressOf,
  type CinemaInput,
} from '../app/utils/cinema'

/**
 * The rotation is a stylesheet over these decisions. Two of them are the ones
 * that would embarrass the screen if wrong: showing an act that has nothing in
 * it, and going on showing last night's costs while somebody waits.
 */

function input(over: Partial<CinemaInput> = {}): CinemaInput {
  return {
    needsYou: 0,
    tiles: 4,
    landedToday: 0,
    runsInWindow: 0,
    ...over,
  }
}

describe('which acts are in the rotation', () => {
  it('leaves out an act with nothing to say', () => {
    expect(actsFor(input()).map(a => a.id)).toEqual(['fleet'])
  })

  it('adds each one as its subject appears', () => {
    expect(actsFor(input({ runsInWindow: 3 })).map(a => a.id)).toEqual(['fleet', 'night'])
    expect(actsFor(input({ landedToday: 2 })).map(a => a.id)).toEqual(['fleet', 'landed'])
  })

  it('has no money act at all', () => {
    // Almost everybody here is on a subscription and is never billed for a run,
    // so the rate-limit meter in the header is the honest version of this. A
    // screen-sized dollar figure would be a notional number in the largest type
    // on the wall.
    expect(ACTS.map(a => a.id)).not.toContain('cost')
  })

  it('keeps the fleet even with no sessions at all', () => {
    // Its empty state is a statement — nothing is running, here is what is due.
    expect(actsFor(input({ tiles: 0 })).map(a => a.id)).toEqual(['fleet'])
  })

  it('narrows to what can be acted on while something waits on a person', () => {
    const busy = input({ needsYou: 2, runsInWindow: 9, landedToday: 4 })
    expect(actsFor(busy).map(a => a.id)).toEqual(['needs-you', 'fleet'])
  })

  it('never offers the attention act when nothing is waiting', () => {
    const rich = input({ runsInWindow: 9, landedToday: 4 })
    expect(actsFor(rich).map(a => a.id)).not.toContain('needs-you')
  })

  it('keeps the canonical order whatever is included', () => {
    const all = actsFor(input({ runsInWindow: 1, landedToday: 1 })).map(a => a.id)
    expect(all).toEqual(['fleet', 'night', 'landed'])
  })
})

describe('stepping round the loop', () => {
  const acts = actsFor(input({ runsInWindow: 1, landedToday: 1 }))

  it('advances in order and wraps', () => {
    expect(nextAct('fleet', acts).id).toBe('night')
    expect(nextAct('night', acts).id).toBe('landed')
    expect(nextAct('landed', acts).id).toBe('fleet')
  })

  it('goes backwards and wraps the other way', () => {
    expect(prevAct('fleet', acts).id).toBe('landed')
    expect(prevAct('night', acts).id).toBe('fleet')
  })

  it('recovers when the act on screen has left the rotation', () => {
    // The moment the last blocked session is answered — which is exactly when a
    // wall becomes good news, so it must not be the case that breaks it.
    expect(nextAct('needs-you', acts).id).toBe('fleet')
    expect(prevAct('needs-you', acts).id).toBe('fleet')
  })

  it('survives an empty rotation rather than returning nothing', () => {
    expect(nextAct('fleet', []).id).toBe('fleet')
  })

  it('holds on the only act there is', () => {
    const only = actsFor(input())
    expect(nextAct('fleet', only).id).toBe('fleet')
  })
})

describe('timing', () => {
  const dwell = 20_000

  it('reports how far through the act it is, clamped both ways', () => {
    expect(progressOf(1000, 1000, dwell)).toBe(0)
    expect(progressOf(1000, 11_000, dwell)).toBeCloseTo(0.5)
    expect(progressOf(1000, 99_000, dwell)).toBe(1)
    // A clock that stepped backwards must not draw a negative bar.
    expect(progressOf(5000, 1000, dwell)).toBe(0)
  })

  it('is due only once the dwell has passed', () => {
    expect(isDue(1000, 20_000, dwell)).toBe(false)
    expect(isDue(1000, 21_000, dwell)).toBe(true)
  })

  it('gives the fleet the longest hold, since it is the one that moves', () => {
    const fleet = actById('fleet').dwellMs
    for (const act of ACTS) {
      if (act.id !== 'fleet') expect(act.dwellMs).toBeLessThanOrEqual(fleet)
    }
  })
})
