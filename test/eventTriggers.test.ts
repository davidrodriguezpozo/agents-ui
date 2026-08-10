import { describe, expect, it } from 'vitest'
import {
  MAX_EVENTS_PER_POLL, describeTrigger, promptFor, selectNew, titleFor, type TriggerEvent,
} from '../server/utils/eventTriggers'

/**
 * A trigger that fires twice for the same pull request spends real money on
 * work that was already done, and one that fires for everything already open
 * the moment it is switched on is worse — it is the first thing somebody sees
 * of the feature. Both are decided here rather than by GitHub.
 */

const event = (key: number): TriggerEvent => ({
  key,
  summary: `pull request #${key}`,
  url: `https://github.com/o/r/pull/${key}`,
})

describe('the first time a trigger is polled', () => {
  it('fires nothing, and records where it came in', () => {
    // Turning on "when a pull request is opened" must not start work on every
    // pull request that was already open.
    const result = selectNew([event(7), event(5), event(9)], undefined)

    expect(result.fire).toEqual([])
    expect(result.cursor).toBe(9)
  })

  it('records a baseline even when nothing is open yet', () => {
    expect(selectNew([], undefined)).toMatchObject({ fire: [], cursor: 0 })
  })
})

describe('afterwards', () => {
  it('fires only what is new', () => {
    const result = selectNew([event(9), event(10), event(11)], 9)

    expect(result.fire.map(e => e.key)).toEqual([10, 11])
    expect(result.cursor).toBe(11)
  })

  it('fires nothing when nothing has happened', () => {
    const result = selectNew([event(9)], 9)

    expect(result.fire).toEqual([])
    // Unchanged, so the caller writes nothing.
    expect(result.cursor).toBe(9)
  })

  it('fires oldest first, so a queue is worked in the order it arrived', () => {
    const result = selectNew([event(12), event(10), event(11)], 9)

    expect(result.fire.map(e => e.key)).toEqual([10, 11, 12])
  })

  it('never goes backwards on an old item reappearing', () => {
    // A closed pull request dropping out and back into the listing must not
    // look like news.
    expect(selectNew([event(3)], 9).fire).toEqual([])
  })
})

describe('when a lot happened at once', () => {
  const many = Array.from({ length: 8 }, (_, i) => event(10 + i))

  it('starts a few rather than a stampede', () => {
    // Ten pull requests appearing while a laptop was shut should not become
    // ten agents the moment it wakes.
    expect(selectNew(many, 9).fire).toHaveLength(MAX_EVENTS_PER_POLL)
  })

  it('leaves the rest for the next poll instead of dropping them', () => {
    const result = selectNew(many, 9)

    expect(result.deferred).toBe(8 - MAX_EVENTS_PER_POLL)
    // The cursor stops at what actually fired, which is what makes the
    // remainder survive to be picked up again.
    expect(result.cursor).toBe(result.fire[result.fire.length - 1]!.key)
  })

  it('picks the deferred ones up next time, with none skipped', () => {
    const first = selectNew(many, 9)
    const second = selectNew(many, first.cursor)

    const fired = [...first.fire, ...second.fire].map(e => e.key)
    expect(fired).toEqual([10, 11, 12, 13, 14, 15])
  })
})

describe('telling the ritual what it is about', () => {
  it('appends the event, leaving the written instruction first', () => {
    const prompt = promptFor('Review it and comment.', event(42))

    expect(prompt.startsWith('Review it and comment.')).toBe(true)
    expect(prompt).toContain('pull request #42')
    expect(prompt).toContain('https://github.com/o/r/pull/42')
  })
})

describe('saying what it waits for', () => {
  it('reads as a sentence, with and without a branch', () => {
    expect(describeTrigger({ kind: 'pr_opened' })).toBe('When a pull request is opened')
    expect(describeTrigger({ kind: 'check_failed', branch: 'main' }))
      .toBe('When a workflow run fails on main')
  })
})

/**
 * Telling one firing from another.
 *
 * A ritual that fires on five pull requests produced five rows in Activity
 * carrying its own name on each, so working out which was which meant opening
 * one and reading its prompt. The ritual's name says what the work is; the
 * event says which one it was about.
 */
describe('naming the run an event produced', () => {
  it('keeps the ritual name and adds what set it off', () => {
    expect(titleFor('Look into red CI', event(42)))
      .toBe('Look into red CI · pull request #42')
  })

  it('gives two firings of the same ritual different names', () => {
    const a = titleFor('Review it', event(1))
    const b = titleFor('Review it', event(2))

    expect(a).not.toBe(b)
  })

  it('trims a summary long enough to swamp the row', () => {
    const long: TriggerEvent = {
      key: 7,
      summary: `pull request #7: ${'a very long title '.repeat(10)}`,
      url: 'https://example.com/7',
    }

    const title = titleFor('Review it', long)
    expect(title.length).toBeLessThan(80)
    expect(title.startsWith('Review it · ')).toBe(true)
    expect(title.endsWith('…')).toBe(true)
  })
})
