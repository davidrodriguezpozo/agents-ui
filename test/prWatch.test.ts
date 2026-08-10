import { describe, expect, it } from 'vitest'
import {
  MAX_FIX_ATTEMPTS, NO_CHECKS_GRACE_MS, decideWatch, fixPrompt, rollupVerdict,
  type PrStatus, type SessionPrWatch,
} from '../server/utils/prWatch'

/**
 * A watcher gets two things badly wrong if nobody pins them down: it merges
 * something that never passed, or it spends three agents fixing the same commit
 * at once. Both are decided by `decideWatch`, so both are decided here.
 */

const watch = (over: Partial<SessionPrWatch> = {}): SessionPrWatch => ({
  state: 'watching',
  number: 7,
  url: 'https://github.com/o/r/pull/7',
  land: false,
  attempts: 0,
  max: MAX_FIX_ATTEMPTS,
  startedAt: 0,
  updatedAt: 0,
  ...over,
})

const status = (over: Partial<PrStatus> = {}): PrStatus => ({
  number: 7,
  url: 'https://github.com/o/r/pull/7',
  state: 'OPEN',
  headSha: 'abc123',
  mergeable: 'MERGEABLE',
  checks: 'passing',
  failing: [],
  ...over,
})

describe('reading the rollup', () => {
  it('calls nothing at all "none" rather than passing', () => {
    // A pull request with no CI has not passed anything, and the difference is
    // the entire reason landing is refused on it.
    expect(rollupVerdict([]).verdict).toBe('none')
  })

  it('is failing the moment one job is, even with others still going', () => {
    const { verdict, failing } = rollupVerdict([
      { name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x/1' },
      { name: 'lint', status: 'IN_PROGRESS' },
    ])

    expect(verdict).toBe('failing')
    expect(failing).toEqual([{ name: 'unit', url: 'https://x/1' }])
  })

  it('is pending while anything is still running, never passing', () => {
    // Half a green suite is not a green suite, and landing on it would be
    // landing on a partial answer.
    expect(rollupVerdict([
      { name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'e2e', status: 'QUEUED' },
    ]).verdict).toBe('pending')
  })

  it('does not treat a cancelled run as a failure', () => {
    // Cancelled is usually a newer push superseding this one. Spending a fix
    // attempt on it would burn a turn on a commit nobody is waiting for.
    expect(rollupVerdict([
      { name: 'unit', status: 'COMPLETED', conclusion: 'CANCELLED' },
    ]).verdict).toBe('passing')
  })

  it('does not treat skipped or neutral as a failure', () => {
    expect(rollupVerdict([
      { name: 'deploy', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { name: 'advisory', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    ]).verdict).toBe('passing')
  })

  it('takes the newest result for a check that was run twice', () => {
    // Taken from a real pull request in this repository, which came back with
    // two CheckRun entries both named "build" against one head commit. Read
    // flat, a failure that was re-run green stays red forever — and the watcher
    // spends every attempt it has fixing something that already passes.
    const { verdict } = rollupVerdict([
      {
        __typename: 'CheckRun',
        name: 'build',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        startedAt: '2026-08-04T17:10:00Z',
        completedAt: '2026-08-04T17:12:53Z',
      },
      {
        __typename: 'CheckRun',
        name: 'build',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        startedAt: '2026-08-04T21:11:27Z',
        completedAt: '2026-08-04T21:14:44Z',
      },
    ])

    expect(verdict).toBe('passing')
  })

  it('does not let a stale pass hide a fresh failure either', () => {
    expect(rollupVerdict([
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: '2026-08-04T17:12:53Z' },
      { name: 'build', status: 'COMPLETED', conclusion: 'FAILURE', completedAt: '2026-08-04T21:14:44Z' },
    ]).verdict).toBe('failing')
  })

  it('falls back to position when a repeat carries no timestamps', () => {
    // GitHub returns these oldest first, so the later entry is the newer one.
    expect(rollupVerdict([
      { name: 'build', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ]).verdict).toBe('passing')
  })

  it('keeps checks with different names apart', () => {
    const { verdict, failing } = rollupVerdict([
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: '2026-08-04T21:14:44Z' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', completedAt: '2026-08-04T17:12:53Z' },
    ])

    expect(verdict).toBe('failing')
    expect(failing.map(c => c.name)).toEqual(['lint'])
  })

  it('reads the older status contexts that appear in the same array', () => {
    const { verdict, failing } = rollupVerdict([
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'FAILURE', targetUrl: 'https://x/2' },
    ])

    expect(verdict).toBe('failing')
    expect(failing).toEqual([{ name: 'ci/legacy', url: 'https://x/2' }])
  })

  it('treats a pending status context as pending', () => {
    expect(rollupVerdict([
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' },
    ]).verdict).toBe('pending')
  })
})

describe('a pull request that has ended', () => {
  it('is done once merged', () => {
    expect(decideWatch(status({ state: 'MERGED' }), watch())).toMatchObject({ action: 'done' })
  })

  it('says so when it was closed instead', () => {
    const decision = decideWatch(status({ state: 'CLOSED' }), watch())

    expect(decision.action).toBe('stop')
    expect(decision.reason).toContain('closed')
  })
})

describe('while CI is still running', () => {
  it('waits, and does not read silence as either answer', () => {
    expect(decideWatch(status({ checks: 'pending' }), watch({ land: true }))).toEqual({ action: 'wait' })
  })
})

describe('a red pull request', () => {
  const red = status({ checks: 'failing', failing: [{ name: 'unit', url: 'https://x/1' }] })

  it('earns a fix turn', () => {
    expect(decideWatch(red, watch())).toMatchObject({ action: 'fix' })
  })

  it('does not earn a second turn for the commit already being worked on', () => {
    // Without this the same failure earns another agent every two minutes,
    // all of them in the same worktree.
    expect(decideWatch(red, watch({ attempts: 1, lastHandledSha: 'abc123' })))
      .toEqual({ action: 'wait' })
  })

  it('earns another turn once a new commit has been tested', () => {
    expect(decideWatch(
      status({ checks: 'failing', headSha: 'def456', failing: [{ name: 'unit', url: '' }] }),
      watch({ attempts: 1, lastHandledSha: 'abc123' }),
    )).toMatchObject({ action: 'fix' })
  })

  it('stops once the attempts are spent, and says how many', () => {
    const decision = decideWatch(red, watch({ attempts: MAX_FIX_ATTEMPTS }))

    expect(decision.action).toBe('stop')
    expect(decision.reason).toContain(String(MAX_FIX_ATTEMPTS))
  })

  it('is never landed, whatever landing is set to', () => {
    expect(decideWatch(red, watch({ land: true })).action).not.toBe('land')
  })
})

describe('a pull request nothing reported on', () => {
  const silent = status({ checks: 'none' })
  // Long enough after the watch began that an empty rollup means what it says.
  const later = NO_CHECKS_GRACE_MS + 1

  it('is refused a landing, because passing nothing is not passing', () => {
    // The merge gate is the product. It must not quietly stop applying to the
    // one merge other people can see.
    const decision = decideWatch(silent, watch({ land: true }), later)

    expect(decision.action).toBe('stop')
    expect(decision.reason).toContain('no checks')
  })

  it('is simply left alone when nobody asked for a landing', () => {
    expect(decideWatch(silent, watch({ land: false }), later).action).toBe('done')
  })

  it('is given time to queue before it is believed', () => {
    // Watching a pull request the moment it is opened is the normal case, and
    // Actions takes a little while to put anything on it. Without this, the
    // usual path ends in "this repository has no CI" a second after you ask.
    expect(decideWatch(silent, watch({ land: true }), NO_CHECKS_GRACE_MS - 1))
      .toEqual({ action: 'wait' })
  })
})

describe('a green pull request', () => {
  it('is left for the person when landing is off', () => {
    const decision = decideWatch(status(), watch({ land: false }))

    expect(decision.action).toBe('done')
    expect(decision.reason).toContain('yours to merge')
  })

  it('is landed when landing is on', () => {
    expect(decideWatch(status(), watch({ land: true }))).toMatchObject({ action: 'land' })
  })

  it('waits while GitHub is still working out whether it merges', () => {
    // UNKNOWN is GitHub computing, not a refusal. Attempting the merge now
    // would just be refused.
    expect(decideWatch(status({ mergeable: 'UNKNOWN' }), watch({ land: true })))
      .toEqual({ action: 'wait' })
  })

  it('stops on a conflict rather than waiting for one to resolve itself', () => {
    const decision = decideWatch(status({ mergeable: 'CONFLICTING' }), watch({ land: true }))

    expect(decision.action).toBe('stop')
    expect(decision.reason).toContain('conflicts')
  })
})

describe('the turn a red pull request earns', () => {
  const red = status({ checks: 'failing', failing: [{ name: 'unit', url: 'https://x/1' }] })

  it('names the failing checks and links them', () => {
    const prompt = fixPrompt(red, 1, 3)

    expect(prompt).toContain('unit')
    expect(prompt).toContain('https://x/1')
  })

  it('forbids the shortest path to green', () => {
    const prompt = fixPrompt(red, 1, 3)

    expect(prompt).toContain('Fix the failure, not the check')
    expect(prompt).toContain('do not edit the workflow')
  })

  it('asks for a commit, since an uncommitted fix is never tested', () => {
    expect(fixPrompt(red, 1, 3)).toContain('Commit what you change')
  })

  it('tells a later attempt that the earlier one failed', () => {
    expect(fixPrompt(red, 2, 3)).toContain('attempt 2 of 3')
  })

  it('does not claim a check was named when GitHub did not name one', () => {
    const prompt = fixPrompt(status({ checks: 'failing', failing: [] }), 1, 3)

    expect(prompt).toContain('without naming the check')
  })
})
