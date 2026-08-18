import { describe, expect, it } from 'vitest'
import {
  SCALE,
  SOUND_LABELS,
  TICKS_PER_POLL,
  diffSounds,
  frequencyFor,
  lengthOf,
  notesFor,
  order,
  pitchIndexFor,
} from '../app/utils/sound'
import type { WallSnapshot, WallTick, WallTile } from '../app/utils/wall'

/**
 * The sound layer is a synthesiser over these decisions, and the decisions are
 * where it can embarrass itself: announcing a Tuesday failure as though it had
 * just happened, or replaying a whole morning to somebody who has just walked up
 * to the screen.
 */

const NOW = new Date(2026, 7, 17, 9, 0, 0).getTime()

function tile(over: Partial<WallTile> = {}): WallTile {
  return {
    sessionId: 'a',
    title: 'a session',
    repo: 'storefront',
    branch: 'session/a',
    activity: 'idle',
    check: null,
    turns: 1,
    updatedAt: NOW,
    pending: 0,
    prompts: [],
    doing: null,
    ...over,
  }
}

function tick(over: Partial<WallTick> = {}): WallTick {
  return { sessionId: 'a', repo: 'storefront', toolName: 'Read', input: {}, at: NOW, ...over }
}

function snapshot(tiles: WallTile[], ticker: WallTick[] = []): WallSnapshot {
  return {
    at: NOW,
    tiles,
    ticker,
    landedToday: [],
    spend: { todayUsd: 0, capUsd: 0 },
    day: { runs: 0, failed: 0, lastHour: 0 },
    quota: null,
    upcoming: [],
    pausedRituals: 0,
    liveSessions: tiles.length,
  }
}

describe('arriving at a wall', () => {
  it('plays nothing at all for the first snapshot', () => {
    const busy = snapshot(
      [tile({ activity: 'working' }), tile({ sessionId: 'b', activity: 'failed' })],
      [tick(), tick({ at: NOW - 1000 })],
    )

    expect(diffSounds(null, busy).events).toEqual([])
  })

  it('counts everything in that first snapshot as already heard', () => {
    const busy = snapshot([tile()], [tick({ at: NOW }), tick({ at: NOW - 5000 })])
    const { tickAt } = diffSounds(null, busy)

    expect(tickAt).toBe(NOW)
    // So the next poll, with nothing newer, is silent too.
    expect(diffSounds(busy, busy, tickAt).events).toEqual([])
  })
})

describe('what makes a sound', () => {
  it('is silent when nothing changed', () => {
    const before = snapshot([tile({ activity: 'working' })])
    expect(diffSounds(before, before, NOW).events).toEqual([])
  })

  it('announces a turn that has started working', () => {
    const before = snapshot([tile({ activity: 'idle' })])
    const after = snapshot([tile({ activity: 'working' })])

    expect(diffSounds(before, after, NOW).events).toEqual([{ kind: 'start', repo: 'storefront' }])
  })

  it('announces a session that appears already working', () => {
    const after = snapshot([tile({ sessionId: 'new', activity: 'working', repo: 'billing' })])
    expect(diffSounds(snapshot([]), after, NOW).events).toEqual([{ kind: 'start', repo: 'billing' }])
  })

  it('says nothing about a session that appears already broken', () => {
    // It has usually just come back into the window the wall draws. Announcing it
    // would be an alarm about something that happened days ago.
    const after = snapshot([
      tile({ sessionId: 'old', activity: 'failed' }),
      tile({ sessionId: 'red', check: { status: 'failing', at: NOW } }),
    ])

    expect(diffSounds(snapshot([]), after, NOW).events).toEqual([])
  })

  it('reports a failure and a pass as they happen', () => {
    const working = snapshot([tile({ activity: 'working' })])
    expect(diffSounds(working, snapshot([tile({ activity: 'failed' })]), NOW).events)
      .toEqual([{ kind: 'fail', repo: 'storefront' }])

    const unchecked = snapshot([tile()])
    expect(diffSounds(unchecked, snapshot([tile({ check: { status: 'passing', at: NOW } })]), NOW).events)
      .toEqual([{ kind: 'pass', repo: 'storefront' }])

    expect(diffSounds(unchecked, snapshot([tile({ check: { status: 'failing', at: NOW } })]), NOW).events)
      .toEqual([{ kind: 'fail', repo: 'storefront' }])
  })

  it('does not re-announce a verdict that merely persists', () => {
    const failing = snapshot([tile({ check: { status: 'failing', at: NOW } })])
    expect(diffSounds(failing, failing, NOW).events).toEqual([])
  })

  it('says nothing about a check that has not run yet or could not', () => {
    const before = snapshot([tile()])
    const running = snapshot([tile({ check: { status: 'running', at: NOW } })])
    const errored = snapshot([tile({ check: { status: 'errored', at: NOW } })])

    expect(diffSounds(before, running, NOW).events).toEqual([])
    expect(diffSounds(before, errored, NOW).events).toEqual([])
  })

  it('announces something that has stopped to ask', () => {
    const before = snapshot([tile({ activity: 'working' })])
    const after = snapshot([tile({ activity: 'awaiting-permission', pending: 1 })])

    expect(diffSounds(before, after, NOW).events).toEqual([{ kind: 'attention', repo: 'storefront' }])
  })

  it('announces landing, and nothing else about that session', () => {
    const before = snapshot([tile({ check: { status: 'passing', at: NOW } })])
    const after = snapshot([tile({
      landedAt: NOW,
      landedHow: 'merged',
      // Both of these would otherwise have something to say.
      check: { status: 'failing', at: NOW },
      pending: 1,
    })])

    expect(diffSounds(before, after, NOW).events).toEqual([{ kind: 'land', repo: 'storefront' }])
  })

  it('says nothing about a session that has gone', () => {
    const before = snapshot([tile({ activity: 'working' })])
    expect(diffSounds(before, snapshot([]), NOW).events).toEqual([])
  })
})

describe('the heartbeat', () => {
  it('plays only ticks newer than the last one heard', () => {
    const before = snapshot([tile()])
    const after = snapshot([tile()], [
      tick({ at: NOW + 2000 }),
      tick({ at: NOW + 1000 }),
      tick({ at: NOW - 1000 }),
    ])

    const { events, tickAt } = diffSounds(before, after, NOW)
    expect(events).toEqual([
      { kind: 'tick', repo: 'storefront' },
      { kind: 'tick', repo: 'storefront' },
    ])
    expect(tickAt).toBe(NOW + 2000)
  })

  it('caps a busy poll rather than turning it into static', () => {
    const ticks = Array.from({ length: 20 }, (_, i) => tick({ at: NOW + i + 1 }))
    const { events } = diffSounds(snapshot([tile()]), snapshot([tile()], ticks), NOW)

    expect(events).toHaveLength(TICKS_PER_POLL)
  })

  it('keeps the newest ticks when it caps, not the oldest', () => {
    const ticks = [
      tick({ at: NOW + 1, repo: 'old' }),
      tick({ at: NOW + 2, repo: 'old' }),
      tick({ at: NOW + 3, repo: 'old' }),
      tick({ at: NOW + 4, repo: 'newest' }),
    ]
    const { events } = diffSounds(snapshot([tile()]), snapshot([tile()], ticks), NOW)

    expect(events[0]!.repo).toBe('newest')
  })
})

describe('order', () => {
  it('puts the news before the noise', () => {
    const mixed = order([
      { kind: 'tick', repo: 'a' },
      { kind: 'fail', repo: 'b' },
      { kind: 'land', repo: 'c' },
      { kind: 'tick', repo: 'd' },
      { kind: 'attention', repo: 'e' },
    ])

    expect(mixed.map(e => e.kind)).toEqual(['land', 'attention', 'fail', 'tick', 'tick'])
  })

  it('does not mutate what it was given', () => {
    const events = [{ kind: 'tick' as const }, { kind: 'land' as const }]
    order(events)
    expect(events.map(e => e.kind)).toEqual(['tick', 'land'])
  })
})

describe('a repository has a pitch', () => {
  it('is the same every time, for the same name', () => {
    expect(pitchIndexFor('billing')).toBe(pitchIndexFor('billing'))
    expect(frequencyFor('billing')).toBe(frequencyFor('billing'))
  })

  it('stays inside the scale', () => {
    for (const repo of ['a', 'billing', 'storefront', 'agents-ui', 'a-very-long-repository-name']) {
      const index = pitchIndexFor(repo)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(SCALE.length)
    }
  })

  it('spreads a handful of repositories across more than one note', () => {
    const notes = new Set(['billing', 'storefront', 'docs', 'agents-ui', 'marketing'].map(pitchIndexFor))
    expect(notes.size).toBeGreaterThan(1)
  })

  it('answers for a tick with no repository rather than throwing', () => {
    expect(pitchIndexFor(undefined)).toBe(0)
    expect(frequencyFor(undefined, 220)).toBe(220)
  })

  it('is a real frequency, in the range a small speaker can produce', () => {
    for (const repo of ['billing', 'storefront', 'docs']) {
      const hz = frequencyFor(repo)
      expect(hz).toBeGreaterThan(200)
      expect(hz).toBeLessThan(700)
    }
  })
})

/**
 * The six sounds, as an executable description.
 *
 * Here rather than in the composable because a synthesiser in a browser needs a
 * gesture, a speaker and a foreground tab to reach — and a backgrounded tab
 * throttles its own timers to once a minute, which is how the falling note went
 * unobserved for an afternoon. As data, every one of them can be asserted.
 */
describe('what each sound is made of', () => {
  const HZ = 220

  it('gives every kind at least one note', () => {
    for (const kind of ['tick', 'start', 'pass', 'fail', 'land', 'attention'] as const) {
      expect(notesFor(kind, HZ).length).toBeGreaterThan(0)
    }
  })

  it('makes a tick short and high — the sound of something small', () => {
    const [note] = notesFor('tick', HZ)
    expect(note!.hz).toBe(HZ * 2)
    expect(note!.length).toBeLessThan(0.1)
    expect(lengthOf('tick', HZ)).toBeLessThan(0.1)
  })

  it('makes work rise', () => {
    for (const kind of ['start', 'pass'] as const) {
      const notes = notesFor(kind, HZ)
      const pitches = notes.map(n => n.hz)
      expect(pitches).toEqual([...pitches].sort((a, b) => a - b))
      expect(pitches.at(-1)).toBeGreaterThan(pitches[0]!)
    }
  })

  it('makes failure fall, and low', () => {
    const [note] = notesFor('fail', HZ)
    expect(note!.to).toBeDefined()
    expect(note!.to!).toBeLessThan(note!.hz)
    // Below the pitch the same repository ticks at, so it cannot be mistaken for one.
    expect(note!.hz).toBeLessThan(HZ)
  })

  it('lets only landing ring for a second', () => {
    expect(lengthOf('land', HZ)).toBeGreaterThan(1)

    for (const kind of ['tick', 'start', 'pass', 'fail', 'attention'] as const) {
      expect(lengthOf(kind, HZ)).toBeLessThan(1)
    }
  })

  it('builds the bell out of an inharmonic partial, which is what makes it a bell', () => {
    const notes = notesFor('land', HZ)
    expect(notes.length).toBeGreaterThan(1)

    const [fundamental, ...partials] = notes
    // Not a whole multiple of the fundamental: that is the difference between a
    // bell and an organ.
    const ratio = partials[0]!.hz / fundamental!.hz
    expect(Math.abs(ratio - Math.round(ratio))).toBeGreaterThan(0.1)
    // And the partials are quieter than what they colour.
    for (const partial of partials) expect(partial.gain).toBeLessThan(fundamental!.gain)
  })

  it('makes the one that wants a person the only one that repeats itself', () => {
    const notes = notesFor('attention', HZ)
    const pitches = notes.map(n => n.hz)

    expect(notes.length).toBe(4)
    expect(pitches.slice(0, 2)).toEqual(pitches.slice(2, 4))
    // Down then up, which is the shape of a question.
    expect(pitches[0]).toBeGreaterThan(pitches[1]!)
  })

  it('never asks for a gain that would clip once the master gain is applied', () => {
    for (const kind of ['tick', 'start', 'pass', 'fail', 'land', 'attention'] as const) {
      for (const note of notesFor(kind, HZ)) {
        expect(note.gain).toBeGreaterThan(0)
        expect(note.gain).toBeLessThanOrEqual(0.5)
      }
    }
  })

  it('scales every note with the repository pitch', () => {
    const low = notesFor('pass', 110).map(n => n.hz)
    const high = notesFor('pass', 220).map(n => n.hz)
    expect(high).toEqual(low.map(hz => hz * 2))
  })

  it('has a legend entry for every sound, so a room can be told what it heard', () => {
    for (const kind of ['tick', 'start', 'pass', 'fail', 'land', 'attention'] as const) {
      expect(SOUND_LABELS[kind]).toBeTruthy()
    }
  })
})
