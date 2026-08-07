import { describe, expect, it } from 'vitest'
import { bySection, outcomeOf, type SessionShape } from '../app/utils/sessionOutcome'

/**
 * `idle` meant two opposite things. A session that thought about it and wrote
 * nothing, and a session that wrote twelve files and is waiting to be merged,
 * were both idle — and on a page of sixteen that is the difference between
 * finished business and the whole reason to leave it running.
 */

function session(over: Partial<SessionShape> = {}): SessionShape {
  return { activity: 'idle', worktree: { changedFiles: 0, dirty: false }, ...over }
}

const withChanges = (n = 3) => session({ worktree: { changedFiles: n, dirty: true } })

describe('outcomeOf', () => {
  it('separates work that produced something from work that did not', () => {
    expect(outcomeOf(withChanges())).toBe('ready')
    expect(outcomeOf(session())).toBe('nothing')
  })

  it('counts an uncommitted workspace as something produced', () => {
    // Changed files can read as zero against the base while the workspace is
    // plainly dirty, and either one means there is something to look at.
    expect(outcomeOf(session({ worktree: { changedFiles: 0, dirty: true } }))).toBe('ready')
  })

  it('puts a session with failing checks where the asking ones are', () => {
    // It is not asking for anything, which is exactly the problem: left on its
    // own it reads as done and quietly stays broken.
    expect(outcomeOf(session({ check: { status: 'failing' } as any }))).toBe('needs-you')
  })

  it('does not call a session ready while its checks are still running', () => {
    const running = session({ ...withChanges(), check: { status: 'running' } as any })
    expect(outcomeOf(running)).toBe('working')
  })

  it('treats a failed or blocked session as needing you', () => {
    expect(outcomeOf(session({ activity: 'awaiting-permission' }))).toBe('needs-you')
    expect(outcomeOf(session({ activity: 'failed' }))).toBe('needs-you')
  })

  it('keeps a working session out of the decisions', () => {
    expect(outcomeOf(session({ activity: 'working' }))).toBe('working')
  })

  it('reports a lost workspace as its own thing, not as a failure', () => {
    // Changes and all — a workspace that is not there cannot be merged, and
    // saying "done, waiting for you" about it would send you to a dead end.
    expect(outcomeOf({ ...withChanges(), activity: 'missing' })).toBe('gone')
  })

  it('survives a session with no worktree record at all', () => {
    expect(outcomeOf({ activity: 'idle' })).toBe('nothing')
    expect(outcomeOf({ activity: 'idle', worktree: null })).toBe('nothing')
  })

  it('passing checks with changes is ready, not merely passing', () => {
    const passed = { ...withChanges(), check: { status: 'passing' } as any }
    expect(outcomeOf(passed)).toBe('ready')
  })
})

describe('bySection', () => {
  it('drops sections nothing falls into', () => {
    const groups = bySection([withChanges(), withChanges()])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.section.outcome).toBe('ready')
  })

  it('leads with what needs you and ends with what came to nothing', () => {
    const groups = bySection([
      session(),
      withChanges(),
      session({ activity: 'awaiting-permission' }),
    ])
    expect(groups.map(g => g.section.outcome)).toEqual(['needs-you', 'ready', 'nothing'])
  })

  it('loses nobody', () => {
    const all = [
      session(),
      withChanges(),
      session({ activity: 'working' }),
      session({ activity: 'missing' }),
      session({ activity: 'awaiting-permission' }),
    ]
    const total = bySection(all).reduce((n, g) => n + g.sessions.length, 0)
    expect(total).toBe(all.length)
  })
})
