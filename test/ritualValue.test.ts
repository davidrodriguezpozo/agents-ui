import { describe, expect, it } from 'vitest'
import {
  ENOUGH_RUNS, REAL_MONEY_USD, ritualValueOf,
  type RitualValueInput,
} from '../server/utils/ritualValue'
import type { RitualOutcome } from '../server/utils/ritualHistory'

/**
 * Whether a ritual earns its keep, said in one line.
 *
 * The failure this guards is a single sentence: the morning briefing being told
 * it produced nothing. It never merges anything and never will, and a page that
 * scored it on merges would be confidently wrong about the most useful thing on
 * it. Everything else here is the other half — a ritual that *is* meant to land
 * code, has cost real money and has landed nothing must say so in words, or the
 * page is only flattering.
 */

function firings(...outcomes: RitualOutcome[]) {
  return outcomes.map(outcome => ({ outcome }))
}

function group(patch: { costUsd?: number; landings?: number; costPerLandingUsd?: number | null } = {}) {
  const total = patch.landings ?? 0
  return {
    costUsd: patch.costUsd ?? 0,
    landings: { total, merged: total, pullRequest: 0, elsewhere: 0 },
    costPerLandingUsd: patch.costPerLandingUsd ?? null,
  }
}

function value(patch: Partial<RitualValueInput> = {}) {
  return ritualValueOf({ firings: [], days: 30, ...patch })
}

describe('a ritual that reports', () => {
  it('is not told it produced nothing', () => {
    // The morning brief: three weeks of working perfectly, nothing merged, and
    // nothing should have been.
    const verdict = value({
      firings: firings('ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'),
      group: group({ costUsd: 12.4 }),
    })

    expect(verdict.expects).toBe('report')
    expect(verdict.tone).toBe('plain')
    expect(verdict.verdict).toContain('$12.40')
    expect(verdict.verdict).toContain('reports rather than lands')
    // The sentences that would be wrong about it.
    expect(verdict.verdict).not.toContain('nothing landed')
    expect(verdict.verdict).not.toContain('Worth deciding')
  })

  it('is taken to be reporting when nothing on the ritual says otherwise', () => {
    const verdict = value({ firings: firings('ok', 'ok', 'ok'), group: group({ costUsd: 40 }) })

    expect(verdict.expects).toBe('report')
    // And says the reading was its own, because it is the one thing here a
    // person can correct.
    expect(verdict.assumed).toBe(true)
  })

  it('credits a landing behind it rather than calling it a surprise', () => {
    const verdict = value({
      expects: 'report',
      firings: firings('ok', 'ok', 'ok', 'ok'),
      group: group({ costUsd: 8, landings: 1, costPerLandingUsd: 8 }),
    })

    expect(verdict.tone).toBe('good')
    expect(verdict.verdict).toContain('1 change landed behind it anyway')
    expect(verdict.assumed).toBe(false)
  })
})

describe('a ritual that lands', () => {
  it('reports what a landing cost it', () => {
    const verdict = value({
      firings: firings('ok', 'ok', 'ok', 'ok', 'ok'),
      group: group({ costUsd: 30, landings: 3, costPerLandingUsd: 9 }),
    })

    // Read off the records: it has landed something, so it is one that lands.
    expect(verdict.expects).toBe('code')
    expect(verdict.assumed).toBe(true)
    expect(verdict.tone).toBe('good')
    expect(verdict.verdict).toBe(
      '$30.00 over 5 runs in the last 30 days, 3 landed — $9.00 a landing.',
    )
  })

  it('says the money and the nothing when three weeks have produced neither', () => {
    // The sentence the brief exists for. Only sayable because the ritual itself
    // says it is meant to land code — the records here look exactly like a
    // briefing's.
    const verdict = value({
      expects: 'code',
      days: 21,
      firings: firings('ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'),
      group: group({ costUsd: 41 }),
    })

    expect(verdict.tone).toBe('warn')
    expect(verdict.verdict).toBe(
      '$41.00 over 7 runs in the last 21 days, and nothing landed. '
      + 'Worth deciding whether to keep it.',
    )
  })

  it('does not make a fuss over small change', () => {
    const verdict = value({
      expects: 'code',
      firings: firings('ok', 'ok', 'ok', 'ok'),
      group: group({ costUsd: REAL_MONEY_USD - 0.01 }),
    })

    expect(verdict.tone).toBe('plain')
    expect(verdict.verdict).toContain('cheap either way')
  })
})

describe('too little to go on', () => {
  it('declines to judge a ritual with two runs', () => {
    const verdict = value({ firings: firings('ok', 'ok'), group: group({ costUsd: 60 }) })

    expect(verdict.runs).toBe(2)
    expect(verdict.tone).toBe('plain')
    expect(verdict.verdict).toBe(
      '$60.00 over 2 runs in the last 30 days. Too few to say whether it earns its keep.',
    )
  })

  it('holds that line even for a ritual that says it lands code', () => {
    // Sixty dollars and no merge is a suspicious start, and a start is all it
    // is. Two is a coincidence — the same reasoning as GIVE_UP_AFTER.
    const verdict = value({
      expects: 'code',
      firings: firings('ok', 'failed'),
      group: group({ costUsd: 60 }),
    })

    expect(verdict.tone).toBe('plain')
    expect(verdict.verdict).toContain('Too few')
    expect(ENOUGH_RUNS).toBe(3)
  })

  it('says a ritual has not run rather than reporting a free one', () => {
    const verdict = value()

    expect(verdict.verdict).toBe('It has not run in the last 30 days.')
    expect(verdict.costPerLandingUsd).toBeNull()
  })
})

describe('the counting', () => {
  it('puts the reliability problem first, whatever the ritual is for', () => {
    const verdict = value({
      expects: 'report',
      firings: firings('failed', 'blocked', 'failed'),
      group: group({ costUsd: 3 }),
    })

    expect(verdict.emptyRuns).toBe(3)
    expect(verdict.tone).toBe('warn')
    expect(verdict.verdict).toContain('every one of them came to nothing')
  })

  it('does not count a firing the machine lost as one that came to nothing', () => {
    // A deploy or a reboot mid-run is not evidence about the ritual, which is
    // the judgement `summarizeRitualRuns` already makes about the streak.
    const verdict = value({
      firings: [
        { outcome: 'failed', interrupted: true },
        { outcome: 'ok' },
        { outcome: 'ok' },
      ],
      group: group({ costUsd: 1 }),
    })

    expect(verdict.runs).toBe(3)
    expect(verdict.emptyRuns).toBe(0)
    expect(verdict.verdict).not.toContain('came to nothing')
  })

  it('leaves per landing empty rather than dividing by no landings', () => {
    const verdict = value({
      expects: 'code',
      firings: firings('ok', 'ok', 'ok'),
      // A group can carry a stale ratio; nothing landed, so there is no answer.
      group: group({ costUsd: 9, landings: 0, costPerLandingUsd: 4 }),
    })

    expect(verdict.landings).toBe(0)
    expect(verdict.costPerLandingUsd).toBeNull()
  })

  it('says a day rather than 1 days', () => {
    expect(value({ days: 1 }).verdict).toBe('It has not run in the last day.')
  })
})
