import { describe, expect, it } from 'vitest'
import { pullWork, workByPull, workersOnPull, type WorkSession } from '../app/utils/pullWork'

/**
 * Whether the Land page already has a session on a pull request.
 *
 * The row offers to start one either way, so the failure this guards is the
 * embarrassing kind: pressing "Address it" on a pull request you have had a
 * session open on since this morning, and only learning about it from the toast
 * that arrives afterwards.
 *
 * The two identifiers are tested separately because they fail separately. A
 * session started from Land carries `prUrl` and matches even if its checkout
 * wanders. A session started from a branch that somebody else opened a pull
 * request on has no `prUrl` at all and can only be found by branch.
 */

const PULL = {
  number: 482,
  url: 'https://github.com/davidrodriguezpozo/agents-ui/pull/482',
  headBranch: 'feat/land-shows-open-sessions',
}

function session(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'sess-1',
    title: '#482 Land shows open sessions',
    branch: 'feat/land-shows-open-sessions',
    status: 'idle',
    activity: 'idle',
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('workersOnPull', () => {
  it('matches the session whose record names the pull request', () => {
    const found = workersOnPull(PULL, [session({ branch: 'something-else', prUrl: PULL.url })])
    expect(found).toHaveLength(1)
    expect(found[0]!.how).toBe('pr-url')
  })

  it('matches on the branch when nothing recorded a pull request', () => {
    // How a session started from /work on a branch a colleague later opened a
    // pull request on gets found: there is no `prUrl` to compare.
    const found = workersOnPull(PULL, [session()])
    expect(found).toHaveLength(1)
    expect(found[0]!.how).toBe('branch')
  })

  it('follows a drifted checkout to the branch it is really on', () => {
    // The agent ran `gh pr checkout`. Its commits are on the pull request's
    // branch, so that is the work this pull request has — see ~/utils/checkout.
    const found = workersOnPull(PULL, [session({
      branch: 'session-cut-branch',
      driftedTo: PULL.headBranch,
    })])
    expect(found).toHaveLength(1)
  })

  it('finds a detached review session', () => {
    // Its worktree holds a commit rather than the branch, on purpose. The record
    // still names the head branch, which is what identifies the work.
    const found = workersOnPull(PULL, [session({ detached: true, prUrl: PULL.url })])
    expect(found[0]!.reviewing).toBe(true)
  })

  it('ignores another repository with the same pull request number', () => {
    // Every repository has a #482. The sessions store holds every project on the
    // machine, so comparing numbers alone would put somebody else's work here.
    const found = workersOnPull(PULL, [session({
      branch: 'unrelated',
      prUrl: 'https://github.com/acme/other-repo/pull/482',
    })])
    expect(found).toEqual([])
  })

  it('ignores an unrelated branch', () => {
    expect(workersOnPull(PULL, [session({ branch: 'main' })])).toEqual([])
  })

  it('leaves out archived sessions', () => {
    // Their worktree is gone. Counting them would claim open work on a pull
    // request finished last week.
    expect(workersOnPull(PULL, [session({ status: 'archived' })])).toEqual([])
  })

  it('never matches a pull request with no head branch', () => {
    // GitHub occasionally hands back an empty `headRefName` — see
    // server/utils/reviews.ts. Matching it against a session whose branch is
    // also empty would attach every unnamed thing to one row.
    const anonymous = { ...PULL, headBranch: '' }
    expect(workersOnPull(anonymous, [session({ branch: '' })])).toEqual([])
  })

  it('puts the session that wants something first', () => {
    const found = workersOnPull(PULL, [
      session({ id: 'idle', activity: 'idle' }),
      session({ id: 'working', activity: 'working' }),
      session({ id: 'asking', activity: 'awaiting-permission' }),
    ])
    expect(found.map(w => w.id)).toEqual(['asking', 'working', 'idle'])
  })

  it('ranks a session you have filed below every live one', () => {
    // Filed means you said you were done with it. It is still open work by the
    // letter of it — the workspace is there — but it must not be the thing the
    // row shouts about while something live exists.
    const found = workersOnPull(PULL, [
      session({ id: 'filed', filedAt: 1_700_000_000_000 }),
      session({ id: 'live' }),
    ])
    expect(found.map(w => w.id)).toEqual(['live', 'filed'])
  })

  it('breaks a tie on what you touched last', () => {
    const found = workersOnPull(PULL, [
      session({ id: 'older', updatedAt: 1 }),
      session({ id: 'newer', updatedAt: 2 }),
    ])
    expect(found.map(w => w.id)).toEqual(['newer', 'older'])
  })
})

describe('pullWork', () => {
  it('says nothing at all when nothing has started', () => {
    expect(pullWork(PULL, [])).toBeNull()
    expect(pullWork(PULL, [session({ branch: 'main' })])).toBeNull()
  })

  it('distinguishes a review in flight from a branch being changed', () => {
    const reviewing = pullWork(PULL, [session({ activity: 'working', detached: true })])
    const changing = pullWork(PULL, [session({ activity: 'working' })])

    expect(reviewing!.label).toBe('Reviewing now')
    expect(changing!.label).toBe('Working on it')
    expect(reviewing!.spin).toBe(true)
  })

  it('names an idle review differently from an idle branch', () => {
    expect(pullWork(PULL, [session({ detached: true })])!.label).toBe('Review open')
    expect(pullWork(PULL, [session()])!.label).toBe('Session open')
  })

  it('leads with a session waiting on a decision', () => {
    const work = pullWork(PULL, [session({ activity: 'awaiting-permission' })])
    expect(work!.label).toBe('Session needs you')
    expect(work!.tone).toBe('attention')
  })

  it('counts several, and takes the state of the strongest', () => {
    const work = pullWork(PULL, [
      session({ id: 'a', activity: 'idle' }),
      session({ id: 'b', activity: 'working' }),
    ])

    expect(work!.label).toBe('2 sessions')
    expect(work!.tone).toBe('live')
    expect(work!.primary.id).toBe('b')
    expect(work!.detail).toContain('and 1 more')
  })

  it('is quiet about a session you have set aside', () => {
    const work = pullWork(PULL, [session({ filedAt: 1_700_000_000_000 })])
    expect(work!.label).toBe('Set aside')
    expect(work!.tone).toBe('quiet')
  })

  it('links at the session it leads with', () => {
    const work = pullWork(PULL, [
      session({ id: 'idle-one' }),
      session({ id: 'busy-one', activity: 'working' }),
    ])
    expect(work!.primary.id).toBe('busy-one')
  })
})

describe('workByPull', () => {
  it('keys the answer by pull request number', () => {
    const other = { number: 7, url: 'https://github.com/davidrodriguezpozo/agents-ui/pull/7', headBranch: 'fix/typo' }
    const map = workByPull([PULL, other], [session(), session({ id: 'typo', branch: 'fix/typo' })])

    expect(map.get(482)!.primary.id).toBe('sess-1')
    expect(map.get(7)!.primary.id).toBe('typo')
  })

  it('holds no entry for a pull request nobody has started', () => {
    const map = workByPull([PULL], [session({ branch: 'main' })])
    expect(map.has(482)).toBe(false)
  })
})
