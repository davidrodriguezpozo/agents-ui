import { describe, expect, it } from 'vitest'
import {
  describeLanding, planLanding, shouldStopRun,
  type LandingInput, type LandingStepResult,
} from '../server/utils/landing'

/**
 * Six sessions branch from main and all go green. Merge the first and the
 * other five are verified against a main that no longer exists — which is the
 * whole reason this cannot be "call merge six times".
 */

function session(over: Partial<LandingInput> = {}): LandingInput {
  return {
    id: 's1',
    title: 'a session',
    status: 'idle',
    activity: 'idle',
    check: { status: 'passing' },
    checkStale: false,
    worktree: { exists: true, changedFiles: 3, dirty: false, ahead: 1, behind: 0 },
    ...over,
  }
}

const wt = (over: Partial<LandingInput['worktree']>) => ({
  ...session().worktree, ...over,
})

describe('planLanding', () => {
  it('merges what is already up to date and green', () => {
    const plan = planLanding([session()])
    expect(plan.queue).toEqual([{ id: 's1', title: 'a session', need: 'ready' }])
  })

  it('wants an update first when the base has moved', () => {
    const plan = planLanding([session({ worktree: wt({ behind: 4 }) })])
    expect(plan.queue[0]!.need).toBe('update')
  })

  it('does not bother distinguishing a stale pass from a fresh one when behind', () => {
    // The update invalidates the verdict either way, so both need the same
    // next step and there is nothing to tell apart.
    const plan = planLanding([session({ checkStale: true, worktree: wt({ behind: 2 }) })])
    expect(plan.queue[0]!.need).toBe('update')
  })

  it('wants a check when there is no usable verdict', () => {
    expect(planLanding([session({ check: null })]).queue[0]!.need).toBe('check')
    expect(planLanding([session({ checkStale: true })]).queue[0]!.need).toBe('check')
  })

  it('goes cheapest first, so early merges do not cost the rest an update each', () => {
    // Ordering is load-bearing: every merge adds a `behind` to everything still
    // queued, so the up-to-date ones want to land before anyone pays for one.
    const plan = planLanding([
      session({ id: 'behind', worktree: wt({ behind: 3 }) }),
      session({ id: 'unchecked', check: null }),
      session({ id: 'green' }),
    ])
    expect(plan.queue.map(c => c.id)).toEqual(['green', 'unchecked', 'behind'])
  })

  it('leaves a failing session for a person', () => {
    // Re-running it will fail again, and merging anyway has to be a choice
    // somebody makes on purpose.
    const plan = planLanding([session({ check: { status: 'failing' } })])
    expect(plan.queue).toEqual([])
    expect(plan.skipped[0]!.reason).toContain('checks fail')
  })

  it('will not merge something still working', () => {
    const plan = planLanding([session({ activity: 'working' })])
    expect(plan.skipped[0]!.reason).toContain('half-done')
  })

  it('will not merge something waiting on a permission', () => {
    expect(planLanding([session({ activity: 'awaiting-permission' })]).queue).toEqual([])
  })

  it('skips a session with nothing in it rather than calling it a failure', () => {
    const empty = session({ worktree: wt({ changedFiles: 0, dirty: false, ahead: 0 }) })
    expect(planLanding([empty]).skipped[0]!.reason).toBe('Nothing in it to merge.')
  })

  it('skips a session whose workspace is gone, and one already closed', () => {
    expect(planLanding([session({ worktree: wt({ exists: false }) })]).queue).toEqual([])
    expect(planLanding([session({ status: 'archived' })]).queue).toEqual([])
  })

  it('counts a session whose checks could not run as unknown, not as passing', () => {
    const plan = planLanding([session({ check: { status: 'errored' } })])
    expect(plan.queue).toEqual([])
    expect(plan.skipped[0]!.reason).toContain('nothing is known')
  })

  it('loses nobody', () => {
    const all = [
      session({ id: 'a' }),
      session({ id: 'b', worktree: wt({ behind: 1 }) }),
      session({ id: 'c', check: { status: 'failing' } }),
      session({ id: 'd', activity: 'working' }),
    ]
    const plan = planLanding(all)
    expect(plan.queue.length + plan.skipped.length).toBe(all.length)
  })
})

describe('shouldStopRun', () => {
  it('carries on when one session fails its own checks', () => {
    // Abandoning four good merges because the third had a bad day is the
    // wrong trade.
    expect(shouldStopRun('checks-failed')).toBe(false)
    expect(shouldStopRun('conflicts')).toBe(false)
    expect(shouldStopRun('no-checks')).toBe(false)
  })

  it('stops when git will not let anything merge here', () => {
    // A dirty checkout or the wrong branch is just as true for everything
    // behind it in the queue.
    expect(shouldStopRun('refused')).toBe(true)
  })
})

describe('describeLanding', () => {
  const result = (outcome: LandingStepResult['outcome']): LandingStepResult =>
    ({ id: 'x', title: 'x', outcome })

  it('says nothing happened when nothing was ready', () => {
    expect(describeLanding([])).toBe('Nothing was ready to land.')
  })

  it('counts what went in and names what did not, separately', () => {
    const said = describeLanding([
      result('merged'), result('merged'),
      result('checks-failed'),
      result('conflicts'),
    ])
    expect(said).toContain('Merged 2 sessions.')
    expect(said).toContain('failed')
    expect(said).toContain('conflict')
  })

  it('reads correctly for one of each', () => {
    const said = describeLanding([result('merged'), result('checks-failed')])
    expect(said).toContain('Merged 1 session.')
    expect(said).toContain('its checks')
  })
})
