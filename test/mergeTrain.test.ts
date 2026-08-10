import { describe, expect, it } from 'vitest'
import {
  MAX_SPINE_COMMITS,
  buildTrain,
  spineFraction,
  summarizeTrain,
  widestAhead,
  type LandingPlan,
  type PlanCandidate,
  type TrainSession,
} from '../app/utils/mergeTrain'

/**
 * The decision is the server's; this is the drawing. So what is tested here is
 * the join and the geometry — not whether a session can land, which
 * `planLanding` answers and `landing.test.ts` covers.
 *
 * An earlier version of this file tested a second, client-side copy of those
 * rules. It passed, and disagreed with the server on five points: it blocked on
 * uncommitted changes the lander commits for you, let a session whose checks
 * errored through as ready, and ordered `update` before `check`. Two plausible
 * numbers on one screen is worse than one.
 */

function session(over: Partial<TrainSession> = {}): TrainSession {
  return {
    id: 's1',
    title: 'a session',
    branch: 'feature-s1',
    baseBranch: 'main',
    repoDir: '/repo',
    worktree: { exists: true, ahead: 2, behind: 0, changedFiles: 3, dirty: false },
    ...over,
  }
}

/** The server always sends a title; these fixtures should too. */
function candidate(over: Partial<PlanCandidate> & Pick<PlanCandidate, 'id' | 'need'>): PlanCandidate {
  return { title: `session ${over.id}`, ...over }
}

function plan(queue: PlanCandidate[], skipped: PlanCandidate[] = []): LandingPlan {
  return { repoDir: '/repo', queue, skipped }
}

describe('joining the plan to the sessions', () => {
  it('keeps the order the server gave, exactly', () => {
    // The queue is already ordered by `planLanding`, and re-sorting it here is
    // how the picture stops matching what the button will do.
    const train = buildTrain(
      plan([
        candidate({ id: 'c', need: 'update' }),
        candidate({ id: 'a', need: 'ready' }),
        candidate({ id: 'b', need: 'check' }),
      ]),
      [session({ id: 'a' }), session({ id: 'b' }), session({ id: 'c' })],
    )

    expect(train.map(c => c.candidate.id)).toEqual(['c', 'a', 'b'])
    expect(train.map(c => c.order)).toEqual([0, 1, 2])
  })

  it('puts skipped sessions after the queue', () => {
    const train = buildTrain(
      plan([candidate({ id: 'a', need: 'ready' })], [candidate({ id: 'z', need: 'blocked', reason: 'Nothing in it to merge.' })]),
      [session({ id: 'a' }), session({ id: 'z' })],
    )

    expect(train.map(c => c.candidate.id)).toEqual(['a', 'z'])
    expect(train[0]!.landable).toBe(true)
    expect(train[1]!.landable).toBe(false)
  })

  it('carries the server\'s reason through', () => {
    const train = buildTrain(
      plan([], [candidate({ id: 'z', need: 'blocked', reason: 'Its checks fail. Fix it, or merge it by hand.' })]),
      [session({ id: 'z' })],
    )

    expect(train[0]!.reason).toBe('Its checks fail. Fix it, or merge it by hand.')
  })

  it('explains an update, which the label alone does not', () => {
    // `planLanding` only writes a reason for blocked candidates.
    const train = buildTrain(plan([candidate({ id: 'a', need: 'update' })]), [session({ id: 'a' })])
    expect(train[0]!.reason).toMatch(/moved base/i)
  })

  it('says nothing extra where the label already said it', () => {
    // "Ready" followed by a longer sentence meaning "ready" is a line people
    // learn to skip, which costs the rows that do carry something.
    for (const need of ['ready', 'check'] as const) {
      const train = buildTrain(plan([candidate({ id: 'a', need })]), [session({ id: 'a' })])
      expect(train[0]!.reason).toBe('')
    }
  })

  it('reads commit counts off the session, which is what it has them for', () => {
    const train = buildTrain(
      plan([candidate({ id: 'a', need: 'ready' })]),
      [session({ id: 'a', worktree: { exists: true, ahead: 5, behind: 3, changedFiles: 2, dirty: true } })],
    )

    expect(train[0]).toMatchObject({ ahead: 5, behind: 3, dirty: true })
  })

  it('still names a session the page has not loaded', () => {
    // The plan is read from disk and may name a session closed since, or one in
    // another project. The row is still drawable from the candidate's title.
    const train = buildTrain(plan([candidate({ id: 'ghost', need: 'ready', title: 'a closed session' })]), [])

    expect(train).toHaveLength(1)
    expect(train[0]!.session).toBeNull()
    expect(train[0]!.ahead).toBe(0)
  })

  it('draws nothing without a plan', () => {
    expect(buildTrain(null, [session()])).toEqual([])
  })

  it('draws nothing for an empty plan', () => {
    expect(buildTrain(plan([]), [session()])).toEqual([])
  })
})

describe('the summary', () => {
  it('counts only queued commits, because blocked ones are not arriving', () => {
    const train = buildTrain(
      plan(
        [candidate({ id: 'a', need: 'ready' }), candidate({ id: 'b', need: 'update' })],
        [candidate({ id: 'c', need: 'blocked', reason: 'Still working.' })],
      ),
      [
        session({ id: 'a', worktree: { exists: true, ahead: 3, behind: 0, changedFiles: 1, dirty: false } }),
        session({ id: 'b', worktree: { exists: true, ahead: 2, behind: 1, changedFiles: 1, dirty: false } }),
        session({ id: 'c', worktree: { exists: true, ahead: 7, behind: 0, changedFiles: 1, dirty: false } }),
      ],
    )

    expect(summarizeTrain(train)).toMatchObject({
      total: 3, landable: 2, blocked: 1, commits: 5, needUpdate: 1,
    })
  })

  it('counts the ones carrying uncommitted work', () => {
    const train = buildTrain(
      plan([candidate({ id: 'a', need: 'check' }), candidate({ id: 'b', need: 'ready' })]),
      [
        session({ id: 'a', worktree: { exists: true, ahead: 0, behind: 0, changedFiles: 2, dirty: true } }),
        session({ id: 'b' }),
      ],
    )

    expect(summarizeTrain(train).dirty).toBe(1)
  })
})

describe('drawing the spine', () => {
  it('scales the widest divergence to the full run', () => {
    expect(spineFraction(4, 4)).toBe(1)
    expect(spineFraction(2, 4)).toBe(0.5)
  })

  it('caps the scale so one runaway session does not squash the rest', () => {
    // Forty commits beside five that are two ahead would otherwise draw the five
    // as nothing at all.
    expect(spineFraction(MAX_SPINE_COMMITS, 40)).toBe(1)
    expect(spineFraction(6, 40)).toBe(0.5)
  })

  it('never exceeds the full run', () => {
    expect(spineFraction(99, 2)).toBe(1)
  })

  it('survives a session with nothing ahead', () => {
    expect(spineFraction(0, 0)).toBe(0)
  })

  it('finds the widest divergence on screen', () => {
    const train = buildTrain(
      plan([candidate({ id: 'a', need: 'ready' }), candidate({ id: 'b', need: 'ready' })]),
      [
        session({ id: 'a', worktree: { exists: true, ahead: 2, behind: 0, changedFiles: 1, dirty: false } }),
        session({ id: 'b', worktree: { exists: true, ahead: 7, behind: 0, changedFiles: 1, dirty: false } }),
      ],
    )

    expect(widestAhead(train)).toBe(7)
    expect(widestAhead([])).toBe(0)
  })
})
