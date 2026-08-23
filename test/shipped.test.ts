import { describe, expect, it } from 'vitest'
import {
  buildShipped,
  dayKeyOf,
  describeShipped,
  verdictOf,
  type ShippedSession,
} from '../server/utils/shipped'

/**
 * The board you can turn a laptop around and show somebody.
 *
 * So the tests are about what a reader who does not write code would be misled
 * by: a day that quietly is not there, a merge over a red check that reads as a
 * success, an address where a name should be, and a branch name anywhere at all.
 */

/** Fixed local noon, so day grouping is not decided by the clock the test ran on. */
const NOON = new Date(2026, 7, 20, 12, 0, 0).getTime()
const DAY = 86_400_000

function session(over: Partial<ShippedSession> = {}): ShippedSession {
  return {
    id: 's1',
    title: 'a-branchy-title',
    repoDir: '/w/webapp',
    summary: { text: 'Invoices now show the tax breakdown' },
    check: { status: 'passing' },
    landed: { at: NOON - 3_600_000, by: { name: 'Ada Lovelace', email: 'ada@example.com' } },
    ...over,
  }
}

describe('a row', () => {
  it('leads with the sentence written when the work finished', () => {
    const [today] = buildShipped([session()], { now: NOON }).days

    expect(today!.items[0]).toMatchObject({
      what: 'Invoices now show the tax breakdown.',
      fromTitle: false,
      who: 'Ada Lovelace',
      where: 'webapp',
      verdict: 'green',
    })
  })

  it('punctuates every sentence the same way', () => {
    // Half the rows ending in a full stop and half not reads as carelessness to
    // exactly the reader this page is for. The summariser is allowed either.
    const board = buildShipped([
      session({ id: 'with', summary: { text: 'Invoices show the tax breakdown.' } }),
      session({ id: 'without', summary: { text: 'Invoices show the tax breakdown' } }),
      session({ id: 'question', summary: { text: 'Did nothing?' } }),
    ], { now: NOON })

    // Sorted on nothing here — the three landed at the same moment — so the set
    // is what matters, not the order.
    expect(board.days[0]!.items.map(i => i.what).sort()).toEqual([
      'Did nothing?',
      'Invoices show the tax breakdown.',
      'Invoices show the tax breakdown.',
    ])
  })

  it('says who by name, never by address', () => {
    const [today] = buildShipped([session()], { now: NOON }).days

    // `personKey` is for adding up money. A wall gets what a person is called.
    expect(today!.items[0]!.who).toBe('Ada Lovelace')
    expect(JSON.stringify(today!.items[0])).not.toContain('@example.com')
  })

  it('names the repository, not the worktree it ran in', () => {
    const [today] = buildShipped(
      [session({ repoDir: '/w/webapp/.worktrees/mt2z09ee5lmu' })],
      { now: NOON },
    ).days

    expect(today!.items[0]!.where).toBe('webapp')
  })

  it('carries no branch, no commit and no cost — structurally, not by omission', () => {
    const [today] = buildShipped([session()], { now: NOON }).days
    const keys = Object.keys(today!.items[0]!).sort()

    // A future template change cannot leak what the row does not hold.
    expect(keys).toEqual(['at', 'fromTitle', 'sessionId', 'verdict', 'what', 'where', 'who'])
  })

  it('falls back to the session title, and says that is what happened', () => {
    const [today] = buildShipped([session({ summary: undefined })], { now: NOON }).days

    expect(today!.items[0]).toMatchObject({ what: 'a-branchy-title.', fromTitle: true })
  })

  it('treats an empty summary as no summary', () => {
    const [today] = buildShipped([session({ summary: { text: '   ' } })], { now: NOON }).days

    expect(today!.items[0]!.fromTitle).toBe(true)
  })
})

describe('the verdict', () => {
  it('tells an override apart from a plain red', () => {
    // Two different pieces of news: one is "this went in broken", the other is
    // "somebody decided it could", and only the second has a person to ask.
    expect(verdictOf(session({
      check: { status: 'failing' },
      landed: { at: NOON, overrodeChecks: true },
    }))).toBe('overridden')

    expect(verdictOf(session({ check: { status: 'failing' } }))).toBe('red')
  })

  it('does not call an unchecked merge green', () => {
    expect(verdictOf(session({ check: null }))).toBe('unchecked')
    expect(verdictOf(session({ check: undefined }))).toBe('unchecked')
  })

  it('calls a check that could not run what it is', () => {
    expect(verdictOf(session({ check: { status: 'errored' } }))).toBe('red')
  })
})

describe('the days', () => {
  it('lists every day in the window, including the empty ones', () => {
    const board = buildShipped([session()], { now: NOON, days: 5 })

    expect(board.days).toHaveLength(5)
    expect(board.days[0]!.items).toHaveLength(1)
    expect(board.days.slice(1).every(day => day.items.length === 0)).toBe(true)
  })

  it('is newest first', () => {
    const board = buildShipped([], { now: NOON, days: 3 })

    expect(board.days.map(d => d.day)).toEqual([
      dayKeyOf(NOON), dayKeyOf(NOON - DAY), dayKeyOf(NOON - 2 * DAY),
    ])
  })

  it('counts whole local days, so a Monday morning still shows all of Friday', () => {
    const fridayEvening = new Date(2026, 7, 17, 22, 0, 0).getTime()
    const mondayMorning = new Date(2026, 7, 20, 9, 0, 0).getTime()

    const board = buildShipped(
      [session({ landed: { at: fridayEvening } })],
      { now: mondayMorning, days: 4 },
    )

    expect(board.total).toBe(1)
    expect(board.days.at(-1)!.items).toHaveLength(1)
  })

  it('puts the newest thing first within a day', () => {
    const board = buildShipped([
      session({ id: 'early', landed: { at: NOON - 6 * 3_600_000 } }),
      session({ id: 'late', landed: { at: NOON - 3_600_000 } }),
    ], { now: NOON })

    expect(board.days[0]!.items.map(i => i.sessionId)).toEqual(['late', 'early'])
  })

  it('leaves out a session that has not landed, and anything outside the window', () => {
    const board = buildShipped([
      { id: 'open', title: 'Still going', repoDir: '/w/webapp' },
      session({ id: 'ancient', landed: { at: NOON - 60 * DAY } }),
    ], { now: NOON, days: 7 })

    expect(board.total).toBe(0)
  })
})

describe('what the page says at the top', () => {
  it('says a fortnight with nothing in it plainly, and not as an error', () => {
    const board = buildShipped([], { now: NOON, days: 14 })

    expect(describeShipped(board)).toBe('Nothing has shipped in the last 14 days.')
  })

  it('counts the things and the days they happened on', () => {
    const board = buildShipped([
      session({ id: 'a' }),
      session({ id: 'b' }),
      session({ id: 'c', landed: { at: NOON - 2 * DAY } }),
    ], { now: NOON, days: 7 })

    expect(describeShipped(board)).toBe('3 things shipped on 2 of the last 7 days.')
  })

  it('says one thing in the singular', () => {
    expect(describeShipped(buildShipped([session()], { now: NOON, days: 7 })))
      .toBe('1 thing shipped on 1 of the last 7 days.')
  })
})
