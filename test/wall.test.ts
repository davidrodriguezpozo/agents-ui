import { describe, expect, it } from 'vitest'
import {
  SETTLED_WINDOW_MS,
  TILE_CAP,
  elapsedLabel,
  isCurrent,
  landedLabel,
  moodOf,
  orderTiles,
  quotaMeter,
  spendMeter,
  takeTiles,
  untilLabel,
  urgencyOf,
  type WallTile,
} from '../app/utils/wall'

/**
 * The wall is a stylesheet over these decisions, and only these can be tested.
 * Two of them are the ones that would make it untrustworthy if wrong: what
 * earns a tile, and what order the tiles go in. A wall sorted by recency looks
 * identical to a wall sorted by urgency until the morning a blocked session is
 * the thirteenth row.
 */

const NOW = new Date(2026, 7, 17, 9, 0, 0).getTime()
const MINUTE = 60_000

function tile(over: Partial<WallTile> = {}): WallTile {
  return {
    sessionId: Math.random().toString(36).slice(2),
    title: 'a session',
    repo: 'agents-ui',
    branch: 'session/a',
    activity: 'idle',
    check: null,
    turns: 1,
    updatedAt: NOW - MINUTE,
    pending: 0,
    doing: null,
    ...over,
  }
}

describe('urgencyOf', () => {
  it('puts a session waiting on a permission answer above everything', () => {
    expect(urgencyOf(tile({ activity: 'awaiting-permission', pending: 1 }))).toBe('needs-you')
  })

  it('treats pending prompts as needing you even if the activity has not caught up', () => {
    // The run status and the broker are two reads; they can disagree for a poll.
    expect(urgencyOf(tile({ activity: 'working', pending: 2 }))).toBe('needs-you')
  })

  it('counts a failed turn and a missing workspace as broken', () => {
    expect(urgencyOf(tile({ activity: 'failed' }))).toBe('broken')
    expect(urgencyOf(tile({ activity: 'missing' }))).toBe('broken')
  })

  it('counts failing checks as broken even when nothing is running', () => {
    expect(urgencyOf(tile({ check: { status: 'failing', at: NOW } }))).toBe('broken')
  })

  it('does not call a landed session broken over a verdict about shipped code', () => {
    const landed = tile({ check: { status: 'failing', at: NOW }, landedAt: NOW, landedHow: 'merged' })
    expect(urgencyOf(landed)).toBe('settled')
  })

  it('reports work in flight as working', () => {
    expect(urgencyOf(tile({ activity: 'working' }))).toBe('working')
  })

  it('reports a checkless idle session as settled', () => {
    expect(urgencyOf(tile())).toBe('settled')
  })
})

describe('isCurrent', () => {
  it('keeps live work whatever its timestamp says', () => {
    const old = tile({ activity: 'working', updatedAt: NOW - SETTLED_WINDOW_MS * 3 })
    expect(isCurrent(old, NOW)).toBe(true)
  })

  it('keeps anything broken however long ago it broke', () => {
    // A failing session that ages off the wall is one nobody is told about again.
    const old = tile({ check: { status: 'failing', at: 0 }, updatedAt: NOW - SETTLED_WINDOW_MS * 10 })
    expect(isCurrent(old, NOW)).toBe(true)
  })

  it('drops settled work once it stops being recent', () => {
    expect(isCurrent(tile({ updatedAt: NOW - SETTLED_WINDOW_MS - 1 }), NOW)).toBe(false)
    expect(isCurrent(tile({ updatedAt: NOW - MINUTE }), NOW)).toBe(true)
  })
})

describe('orderTiles', () => {
  it('ranks by urgency before recency', () => {
    const blocked = tile({ activity: 'awaiting-permission', pending: 1, updatedAt: NOW - 60 * MINUTE, title: 'blocked' })
    const working = tile({ activity: 'working', updatedAt: NOW, title: 'working' })
    const settled = tile({ updatedAt: NOW - MINUTE, title: 'settled' })

    expect(orderTiles([settled, working, blocked]).map(t => t.title)).toEqual(['blocked', 'working', 'settled'])
  })

  it('breaks ties within a group by what moved most recently', () => {
    const older = tile({ activity: 'working', updatedAt: NOW - 5 * MINUTE, title: 'older' })
    const newer = tile({ activity: 'working', updatedAt: NOW, title: 'newer' })

    expect(orderTiles([older, newer]).map(t => t.title)).toEqual(['newer', 'older'])
  })

  it('does not mutate what it was given', () => {
    const tiles = [tile({ title: 'a', updatedAt: NOW - MINUTE }), tile({ activity: 'working', title: 'b' })]
    orderTiles(tiles)
    expect(tiles.map(t => t.title)).toEqual(['a', 'b'])
  })
})

describe('takeTiles', () => {
  it('reports what it could not show rather than dropping it silently', () => {
    const tiles = Array.from({ length: TILE_CAP + 7 }, () => tile({ activity: 'working' }))
    const { shown, hidden } = takeTiles(tiles)

    expect(shown).toHaveLength(TILE_CAP)
    expect(hidden).toBe(7)
  })

  it('keeps the urgent ones when it has to choose', () => {
    const working = Array.from({ length: TILE_CAP }, () => tile({ activity: 'working', updatedAt: NOW }))
    const blocked = tile({ activity: 'awaiting-permission', pending: 1, updatedAt: NOW - 60 * MINUTE, title: 'blocked' })

    const { shown, hidden } = takeTiles([...working, blocked])
    expect(shown[0]!.title).toBe('blocked')
    expect(hidden).toBe(1)
  })

  it('never reports a negative remainder', () => {
    expect(takeTiles([tile()]).hidden).toBe(0)
  })
})

describe('moodOf', () => {
  it('is attention when anything is blocked or broken', () => {
    expect(moodOf([tile({ activity: 'working' }), tile({ activity: 'failed' })])).toBe('attention')
  })

  it('is busy when work is merely in flight', () => {
    expect(moodOf([tile(), tile({ activity: 'working' })])).toBe('busy')
  })

  it('is quiet with nothing running and nothing wrong', () => {
    expect(moodOf([tile(), tile({ landedAt: NOW, landedHow: 'merged' })])).toBe('quiet')
    expect(moodOf([])).toBe('quiet')
  })
})

describe('spendMeter', () => {
  it('draws nothing against a cap nobody set', () => {
    const meter = spendMeter(1.24, 0)
    expect(meter.fraction).toBe(0)
    expect(meter.label).toBe('$1.24 today')
    expect(meter.tone).toBe('quiet')
  })

  it('fills against the cap that actually stops work', () => {
    const meter = spendMeter(2.5, 5)
    expect(meter.fraction).toBeCloseTo(0.5)
    expect(meter.label).toBe('$2.50 of $5')
    expect(meter.tone).toBe('accent')
  })

  it('warns before it is reached and says what happens when it is', () => {
    expect(spendMeter(4, 5).tone).toBe('warning')

    const spent = spendMeter(6, 5)
    expect(spent.fraction).toBe(1)
    expect(spent.tone).toBe('error')
    expect(spent.label).toContain('being skipped')
  })

  it('says what a fraction of a cent is rather than rounding it to nothing', () => {
    expect(spendMeter(0.004, 0).label).toBe('<$0.01 today')
  })
})

describe('quotaMeter', () => {
  const fresh = { status: 'allowed' as const, window: 'weekly', utilization: 0.4, resetsAt: null, stale: false }

  it('says nothing rather than showing a stale reading as current', () => {
    expect(quotaMeter({ ...fresh, stale: true })).toBeNull()
    expect(quotaMeter(null)).toBeNull()
  })

  it('accepts utilization as a fraction or a percentage', () => {
    expect(quotaMeter(fresh)!.fraction).toBeCloseTo(0.4)
    expect(quotaMeter({ ...fresh, utilization: 40 })!.fraction).toBeCloseTo(0.4)
  })

  it('leads with the number when there is one, whatever the status says', () => {
    expect(quotaMeter(fresh)!.label).toBe('40% of weekly')

    // The colour carries the warning so the caption stays one short line.
    const close = quotaMeter({ ...fresh, status: 'allowed_warning', utilization: 0.81 })!
    expect(close.label).toBe('81% of weekly')
    expect(close.tone).toBe('warning')
  })

  it('still says something useful when only the status is known', () => {
    const meter = quotaMeter({ ...fresh, utilization: null })!
    expect(meter.label).toBe('weekly has room')
    expect(meter.fraction).toBe(0)
  })

  it('keeps its words short enough for a header meter', () => {
    // "room on the five-hour limit" ran over the spend figure beside it.
    for (const status of ['allowed', 'allowed_warning', 'rejected'] as const) {
      const meter = quotaMeter({ ...fresh, status, window: 'five-hour', utilization: null })!
      expect(meter.label.length).toBeLessThanOrEqual(24)
    }
  })

  it('fills and reddens when the limit is used up', () => {
    const meter = quotaMeter({ ...fresh, status: 'rejected', utilization: null })!
    expect(meter.fraction).toBe(1)
    expect(meter.tone).toBe('error')
    expect(meter.label).toBe('weekly used up')
  })

  it('warns when close, without needing a number', () => {
    const meter = quotaMeter({ ...fresh, status: 'allowed_warning', utilization: null })!
    expect(meter.tone).toBe('warning')
    expect(meter.fraction).toBeGreaterThan(0.5)
  })
})

describe('elapsedLabel', () => {
  it('counts minutes and seconds, then adds hours when there are some', () => {
    expect(elapsedLabel(NOW - 71_000, NOW)).toBe('1:11')
    expect(elapsedLabel(NOW - 3_671_000, NOW)).toBe('1:01:11')
  })

  it('is empty for a turn that has not started or a clock that has drifted', () => {
    expect(elapsedLabel(undefined, NOW)).toBe('')
    expect(elapsedLabel(NOW + 5_000, NOW)).toBe('')
  })
})

describe('landedLabel', () => {
  it('does not let this app take credit for a merge somebody made in a browser', () => {
    expect(landedLabel('elsewhere')).toBe('merged on github.com')
    expect(landedLabel('merged')).toBe('merged here')
    expect(landedLabel('pull-request')).toBe('pull request merged')
  })
})

describe('untilLabel', () => {
  it('reads at a glance in whichever unit fits', () => {
    expect(untilLabel(NOW + 10_000, NOW)).toBe('now')
    expect(untilLabel(NOW + 12 * MINUTE, NOW)).toBe('in 12m')
    expect(untilLabel(NOW + 3 * 3_600_000, NOW)).toBe('in 3h')
    expect(untilLabel(NOW + 2 * 86_400_000, NOW)).toBe('in 2d')
  })
})
