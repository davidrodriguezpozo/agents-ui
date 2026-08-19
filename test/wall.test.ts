import { describe, expect, it } from 'vitest'
import {
  SETTLED_WINDOW_MS,
  countUrgency,
  groupByRepo,
  withDetail,
  elapsedLabel,
  isCurrent,
  landedLabel,
  moodOf,
  orderTiles,
  quotaMeter,
  spendMeter,
  takeSome,
  asOfLabel,
  checkedLabel,
  orderPulls,
  sinceLabel,
  PULL_TONES,
  untilLabel,
  urgencyOf,
  type WallPull,
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
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

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
    prompts: [],
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

describe('takeSome', () => {
  it('reports what it could not show rather than dropping it silently', () => {
    const { shown, hidden } = takeSome(Array.from({ length: 12 }, (_, i) => i), 5)

    expect(shown).toHaveLength(5)
    expect(hidden).toBe(7)
  })

  it('keeps the urgent ones when a capped panel has to choose', () => {
    // The cap is only safe because whatever is being capped was ordered first:
    // five working rows and a blocked one, cut to five, must keep the blocked one.
    const working = Array.from({ length: 5 }, () => tile({ activity: 'working', updatedAt: NOW }))
    const blocked = tile({ activity: 'awaiting-permission', pending: 1, updatedAt: NOW - 60 * MINUTE, title: 'blocked' })

    const { shown, hidden } = takeSome(orderTiles([...working, blocked]), 5)
    expect(shown[0]!.title).toBe('blocked')
    expect(hidden).toBe(1)
  })

  it('never reports a negative remainder', () => {
    expect(takeSome([tile()], 5).hidden).toBe(0)
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
    // Just the figure: the meter it fills is already captioned "Today".
    expect(meter.label).toBe('$1.24')
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
    expect(spendMeter(0.004, 0).label).toBe('<$0.01')
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

/**
 * The dense view's arithmetic. Grouping exists because somebody with four
 * repositories open needs the one with a problem in it first, so the order of the
 * groups is the part worth testing.
 */
describe('grouping rows by repository', () => {
  it('orders groups by their most urgent row, not alphabetically', () => {
    const lanes = groupByRepo([
      tile({ repo: 'aaa', activity: 'working', updatedAt: NOW }),
      tile({ repo: 'zzz', activity: 'awaiting-permission', pending: 1, updatedAt: NOW - 60 * MINUTE }),
    ])

    expect(lanes.map(l => l.repo)).toEqual(['zzz', 'aaa'])
  })

  it('keeps a repository together and in urgency order inside the group', () => {
    const lanes = groupByRepo([
      tile({ sessionId: '1', repo: 'one', activity: 'working', updatedAt: NOW }),
      tile({ sessionId: '2', repo: 'two', activity: 'working' }),
      tile({ sessionId: '3', repo: 'one', activity: 'failed', updatedAt: NOW - MINUTE }),
    ])

    expect(lanes.map(l => [l.repo, l.tiles.length])).toEqual([['one', 2], ['two', 1]])
    expect(lanes[0]!.tiles[0]!.sessionId).toBe('3')
  })

  it('has nothing to group when there is nothing', () => {
    expect(groupByRepo([])).toEqual([])
  })
})

describe('counting a group', () => {
  it('counts each band once', () => {
    const counts = countUrgency([
      tile({ activity: 'awaiting-permission', pending: 1 }),
      tile({ activity: 'failed' }),
      tile({ activity: 'working' }),
      tile({ activity: 'working' }),
      tile(),
    ])

    expect(counts).toEqual({ 'needs-you': 1, broken: 1, working: 2, settled: 1 })
  })
})

describe('attaching what git knows', () => {
  it('leaves a row saying nothing rather than nothing-changed when unasked', () => {
    const [row] = withDetail([tile()], new Map())
    expect(row!.detail).toBeUndefined()
  })

  it('attaches by session, not by position', () => {
    const rows = withDetail(
      [tile({ sessionId: 'a' }), tile({ sessionId: 'b' })],
      new Map([['b', { changedFiles: 4, behind: 2 }]]),
    )

    expect(rows[0]!.detail).toBeUndefined()
    expect(rows[1]!.detail).toEqual({ changedFiles: 4, behind: 2 })
  })

  it('does not change the live half it was given', () => {
    const rows = withDetail([tile({ sessionId: 'a', activity: 'working' })], new Map([['a', { changedFiles: 1 }]]))
    expect(rows[0]!.activity).toBe('working')
    expect(rows[0]!.detail?.changedFiles).toBe(1)
  })
})

/**
 * The half of the screen that comes off the network.
 *
 * Two decisions matter here and neither is about pull requests. The first is
 * ordering: a panel with room for five rows is only safe if the five it keeps are
 * the five that need somebody, and that is `orderPulls` rather than the panel. The
 * second is time — this data is up to a minute old, and every label that could
 * make it look current is tested for the case where it should not.
 */

function pull(over: Partial<WallPull> = {}): WallPull {
  return {
    repo: 'agents-ui',
    repoDir: '/repos/agents-ui',
    headBranch: 'make-it-faster',
    number: 7,
    title: 'Make it faster',
    url: `https://github.com/o/r/pull/${over.number ?? 7}`,
    author: 'someone',
    mine: false,
    draft: false,
    state: 'awaiting-review',
    label: 'Your review',
    detail: 'Nobody has reviewed it yet',
    onYou: false,
    createdAt: NOW - 60 * MINUTE,
    updatedAt: NOW - MINUTE,
    changedFiles: 3,
    checks: 'passing',
    unresolved: 0,
    awaiting: [],
    ...over,
  }
}

describe('orderPulls', () => {
  it('puts what is on you first, whatever its age', () => {
    const old = pull({ number: 1, onYou: false, createdAt: NOW - 20 * DAY })
    const mine = pull({ number: 2, onYou: true, createdAt: NOW - MINUTE })

    expect(orderPulls([old, mine]).map(p => p.number)).toEqual([2, 1])
  })

  it('breaks ties by which has been sitting longest, not by last activity', () => {
    // A stale review request somebody rebased five minutes ago must not read as
    // the freshest thing in the list.
    const stale = pull({ number: 1, createdAt: NOW - 9 * DAY, updatedAt: NOW })
    const recent = pull({ number: 2, createdAt: NOW - HOUR, updatedAt: NOW - HOUR })

    expect(orderPulls([recent, stale]).map(p => p.number)).toEqual([1, 2])
  })

  it('does not mutate what it was given', () => {
    const pulls = [pull({ number: 1 }), pull({ number: 2, onYou: true })]
    orderPulls(pulls)
    expect(pulls.map(p => p.number)).toEqual([1, 2])
  })
})

describe('PULL_TONES', () => {
  it('reserves red for the two states nothing downstream of is reliable', () => {
    expect(PULL_TONES.conflicted).toBe('error')
    expect(PULL_TONES['checks-failing']).toBe('error')
  })

  it('does not colour the states there is nothing to do about', () => {
    expect(PULL_TONES['checks-running']).toBe('quiet')
    expect(PULL_TONES.draft).toBe('quiet')
  })
})

describe('sinceLabel', () => {
  it('reads in the largest unit that still says something', () => {
    expect(sinceLabel(NOW - 20 * MINUTE, NOW)).toBe('20m')
    expect(sinceLabel(NOW - 5 * HOUR, NOW)).toBe('5h')
    expect(sinceLabel(NOW - 3 * DAY, NOW)).toBe('3d')
  })

  it('says now rather than a fraction of a minute', () => {
    expect(sinceLabel(NOW - 3_000, NOW)).toBe('now')
  })

  it('never counts backwards off a clock that is slightly ahead', () => {
    expect(sinceLabel(NOW + 5_000, NOW)).toBe('now')
  })
})

describe('checkedLabel', () => {
  it('tells never-asked apart from nothing-found', () => {
    // The two look identical in an empty panel and are opposite facts.
    expect(checkedLabel(undefined, NOW)).toBe('never checked')
    expect(checkedLabel(NOW - 3 * HOUR, NOW)).toBe('checked 3h ago')
  })
})

describe('asOfLabel', () => {
  it('counts seconds while the reading is fresh, so a minute-old one is legible', () => {
    expect(asOfLabel(NOW - 12_000, NOW)).toBe('as of 12s ago')
    expect(asOfLabel(NOW - 4 * MINUTE, NOW)).toBe('as of 4m ago')
  })

  it('says it has not been read rather than claiming it was read at the epoch', () => {
    expect(asOfLabel(0, NOW)).toBe('not read yet')
  })
})
