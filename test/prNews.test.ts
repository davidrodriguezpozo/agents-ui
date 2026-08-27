import { describe, expect, it } from 'vitest'
import { askingPlan, newsFor, pullNumberFor, worthAsking } from '../server/utils/prNews'
import type { Session } from '../server/utils/sessions'
import type { LivePull } from '../server/utils/reviewRetire'

/**
 * What the rail is told about the pull request behind a session.
 *
 * Everything here is about one of two ways this goes wrong, and neither of them
 * looks broken on screen:
 *
 *   - **It asks forever.** This rides a poll, so a session whose answer can no
 *     longer change has to leave the set. Merged is final; asking about it every
 *     two minutes for a fortnight is a rate limit spent on nothing.
 *   - **It writes when nothing happened.** Every write is a row the rail reorders
 *     and re-times. "Open, unchanged" is the ordinary answer and must be silent.
 */

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'a',
    title: '#42 fix the totals',
    repoDir: '/repo',
    worktreePath: '/w',
    branch: 'feature-a',
    baseBranch: 'main',
    baseSha: 'base',
    status: 'idle',
    runIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as Session
}

function live(over: Partial<LivePull> = {}): LivePull {
  return { number: 42, state: 'OPEN', headRefOid: 'read-sha', reviewedByYouAt: null, ...over }
}

describe('pullNumberFor', () => {
  it('takes the recorded number a review session carries', () => {
    expect(pullNumberFor(session({ reviewOf: { number: 5683, headSha: 'x' } }))).toBe(5683)
  })

  it('reads your own work\'s number out of the only place it was kept', () => {
    const url = 'https://github.com/acme/app/pull/57'
    expect(pullNumberFor(session({ prUrl: url }))).toBe(57)
  })

  it('is null when there is no pull request to ask about', () => {
    expect(pullNumberFor(session())).toBeNull()
    // A URL that is not one. Guessing a number here would ask GitHub about
    // whatever that digit happened to be.
    expect(pullNumberFor(session({ prUrl: 'https://github.com/acme/app/issues/57' }))).toBeNull()
  })
})

describe('worthAsking', () => {
  it('asks about a review that is still open', () => {
    expect(worthAsking(session({ reviewOf: { number: 42, headSha: 'read-sha' } }))).toBe(true)
  })

  it('stops once the answer cannot change', () => {
    const of = { number: 42, headSha: 'read-sha' }
    const merged = { at: 5, number: 42, state: 'MERGED' as const, headSha: 'read-sha' }
    const closed = { at: 5, number: 42, state: 'CLOSED' as const, headSha: 'read-sha' }

    expect(worthAsking(session({ reviewOf: of, prNews: merged }))).toBe(false)
    expect(worthAsking(session({ reviewOf: of, prNews: closed }))).toBe(false)
  })

  it('keeps asking while it is open, even having said so once', () => {
    // A head that moved is news, and it can move again.
    const news = { at: 5, number: 42, state: 'OPEN' as const, headSha: 'moved' }
    expect(worthAsking(session({ reviewOf: { number: 42, headSha: 'read-sha' }, prNews: news }))).toBe(true)
  })

  it('leaves a session you have finished with alone', () => {
    const of = { number: 42, headSha: 'read-sha' }
    expect(worthAsking(session({ reviewOf: of, status: 'archived' }))).toBe(false)
    expect(worthAsking(session({ reviewOf: of, filedAt: 9 }))).toBe(false)
  })
})

describe('askingPlan', () => {
  it('groups by repository, because that is what one query covers', () => {
    const plan = askingPlan([
      session({ id: 'a', repoDir: '/one', reviewOf: { number: 1, headSha: 'x' } }),
      session({ id: 'b', repoDir: '/two', reviewOf: { number: 2, headSha: 'x' } }),
      session({ id: 'c', repoDir: '/one', prUrl: 'https://github.com/acme/app/pull/3' }),
    ])

    expect([...plan.keys()].sort()).toEqual(['/one', '/two'])
    expect(plan.get('/one')).toEqual([1, 3])
    expect(plan.get('/two')).toEqual([2])
  })

  it('asks once about a pull request two sessions are reviewing', () => {
    const plan = askingPlan([
      session({ id: 'a', reviewOf: { number: 42, headSha: 'x' } }),
      session({ id: 'b', reviewOf: { number: 42, headSha: 'y' } }),
    ])

    expect(plan.get('/repo')).toEqual([42])
  })

  it('leaves out everything with nothing to ask about', () => {
    expect(askingPlan([session(), session({ status: 'archived' })]).size).toBe(0)
  })
})

describe('newsFor', () => {
  const reviewing = session({ reviewOf: { number: 42, headSha: 'read-sha' } })

  it('says nothing about an open pull request nobody has pushed to', () => {
    // The ordinary answer on the ordinary pass. Writing here would reorder the
    // rail and re-date the row for a poll that found nothing.
    expect(newsFor(reviewing, live(), 100)).toBeNull()
  })

  it('reports a merge', () => {
    expect(newsFor(reviewing, live({ state: 'MERGED' }), 100))
      .toEqual({ at: 100, number: 42, state: 'MERGED', headSha: 'read-sha' })
  })

  it('reports a close, which is not the same news', () => {
    expect(newsFor(reviewing, live({ state: 'CLOSED' }), 100)?.state).toBe('CLOSED')
  })

  it('reports a push that came after what this session read', () => {
    expect(newsFor(reviewing, live({ headRefOid: 'pushed-since' }), 100))
      .toEqual({ at: 100, number: 42, state: 'OPEN', headSha: 'pushed-since' })
  })

  it('says nothing twice about the same answer', () => {
    const already = session({
      reviewOf: { number: 42, headSha: 'read-sha' },
      prNews: { at: 1, number: 42, state: 'OPEN', headSha: 'pushed-since' },
    })

    expect(newsFor(already, live({ headRefOid: 'pushed-since' }), 100)).toBeNull()
  })

  it('reports the next push after one it already reported', () => {
    const already = session({
      reviewOf: { number: 42, headSha: 'read-sha' },
      prNews: { at: 1, number: 42, state: 'OPEN', headSha: 'pushed-once' },
    })

    expect(newsFor(already, live({ headRefOid: 'pushed-twice' }), 100)?.headSha).toBe('pushed-twice')
  })

  it('never reports a push on your own work, which read no commit', () => {
    // `prUrl` sessions have no reviewed head to compare against — the branch is
    // theirs and moves because they moved it. Only the ending is news.
    const own = session({ prUrl: 'https://github.com/acme/app/pull/42' })

    expect(newsFor(own, live({ headRefOid: 'anything' }), 100)).toBeNull()
    expect(newsFor(own, live({ state: 'MERGED' }), 100)?.state).toBe('MERGED')
  })

  it('ignores a state it does not recognise', () => {
    // `gh` answering with something new must not put a word on a row that no
    // reader has a case for.
    expect(newsFor(reviewing, live({ state: 'DRAFT' }), 100)).toBeNull()
  })
})
