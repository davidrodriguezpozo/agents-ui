import { describe, expect, it } from 'vitest'
import { sessionBadge, type BadgeInput } from '../app/utils/sessionBadge'

/**
 * Green is a claim: this work is good and ready. The badge has broken that
 * claim three separate times, and every one was found by looking at a rendered
 * page rather than by a test — which is the reason this decision now lives
 * somewhere a test can reach it.
 */

const GREEN = 'rgb(34, 197, 94)'
const AMBER = 'var(--warning)'

function badge(over: Partial<BadgeInput> = {}) {
  return sessionBadge({ activity: 'idle', changedFiles: 3, ...over })
}

const passing = { status: 'passing' } as any

describe('sessionBadge', () => {
  it('is green for a pass against a base that has not moved', () => {
    const b = badge({ check: passing })
    expect(b.label).toBe('Checks pass')
    expect(b.color).toBe(GREEN)
  })

  it('is not green once the base has moved on', () => {
    const b = badge({ check: passing, behind: 17 })
    expect(b.label).toBe('Base moved on')
    expect(b.color).toBe(AMBER)
  })

  it('is not green for unverified changes behind the base either', () => {
    // The actual reported row: "New badge in boms", 17 behind, one changed
    // file, no checks ever run — so it wore green "Changes ready". Both green
    // labels use the word ready, and this is the state where it is least true.
    const b = badge({ changedFiles: 1, behind: 17 })
    expect(b.label).toBe('Base moved on')
    expect(b.color).toBe(AMBER)
  })

  it('says nothing about the base when there is no work to merge', () => {
    // Behind is only interesting if there is something to bring forward.
    expect(badge({ changedFiles: 0, behind: 17 }).label).toBe('No changes')
  })

  it('is not green once the workspace has changed under the verdict', () => {
    const b = badge({ check: passing, checkStale: true })
    expect(b.label).toBe('Passed, then changed')
    expect(b.color).toBe(AMBER)
  })

  it('says the base moved even when both are true, matching the session page', () => {
    // The two pages must never disagree about which matters more.
    expect(badge({ check: passing, checkStale: true, behind: 2 }).label).toBe('Base moved on')
  })

  it('never calls a check that could not run a pass', () => {
    const b = badge({ check: { status: 'errored' } as any })
    expect(b.label).toBe('Checks did not run')
    expect(b.color).not.toBe(GREEN)
  })

  it('ignores a verdict while something is running', () => {
    // Mid-turn, a recorded verdict describes a workspace that has moved on.
    expect(badge({ activity: 'working', check: passing }).label).toBe('Working')
  })

  it('describes the result, not the session, when nothing was produced', () => {
    expect(badge({ changedFiles: 0 }).label).toBe('No changes')
  })

  it('calls unverified changes ready, because nothing was claimed about them', () => {
    // No checks ran, so there is no verdict to be void — only work to look at.
    const b = badge({ changedFiles: 4 })
    expect(b.label).toBe('Changes ready')
    expect(b.color).toBe(GREEN)
  })

  it('puts a blocked or broken session ahead of any verdict', () => {
    expect(badge({ activity: 'awaiting-permission', check: passing }).label).toBe('Needs you')
    expect(badge({ activity: 'failed', check: passing }).label).toBe('Failed')
    expect(badge({ activity: 'missing', check: passing }).label).toBe('Workspace gone')
  })

  it('is green in exactly two cases and no others', () => {
    // A blunt guard on the claim itself: if a new state starts coming back
    // green, this fails rather than shipping another quiet lie.
    const states: BadgeInput[] = [
      { activity: 'idle', changedFiles: 0 },
      { activity: 'idle', changedFiles: 3 },
      { activity: 'idle', changedFiles: 3, check: passing },
      { activity: 'idle', changedFiles: 3, check: passing, behind: 1 },
      { activity: 'idle', changedFiles: 3, behind: 1 },
      { activity: 'idle', changedFiles: 0, behind: 1 },
      { activity: 'idle', changedFiles: 3, check: passing, checkStale: true },
      { activity: 'idle', changedFiles: 3, check: { status: 'failing' } as any },
      { activity: 'idle', changedFiles: 3, check: { status: 'errored' } as any },
      { activity: 'idle', changedFiles: 3, check: { status: 'running' } as any },
      { activity: 'working', changedFiles: 3 },
      { activity: 'failed', changedFiles: 3 },
      { activity: 'missing', changedFiles: 3 },
      { activity: 'awaiting-permission', changedFiles: 3 },
    ]

    const green = states.map(sessionBadge).filter(b => b.color === GREEN).map(b => b.label)
    expect(green).toEqual(['Changes ready', 'Checks pass'])
  })
})

describe('a session whose work is in the base', () => {
  it('says it landed rather than that the base moved on', () => {
    // It is behind by the very merge commit that landed it, so the old reading
    // put an amber "Base moved on" on four sessions that were finished — which
    // asserts there is something to do about work that is already shipped.
    const badge = sessionBadge({
      activity: 'idle',
      changedFiles: 33,
      check: { status: 'passing' } as any,
      behind: 1,
      landed: true,
    })

    expect(badge.label).toBe('Landed')
  })

  it('outranks a stale verdict', () => {
    const badge = sessionBadge({
      activity: 'idle',
      changedFiles: 33,
      check: { status: 'passing' } as any,
      checkStale: true,
      landed: true,
    })

    expect(badge.label).toBe('Landed')
  })

  it('outranks a local failure, which now describes shipped code', () => {
    const badge = sessionBadge({
      activity: 'idle',
      changedFiles: 33,
      check: { status: 'failing' } as any,
      landed: true,
    })

    expect(badge.label).toBe('Landed')
  })

  it('still yields to work happening right now', () => {
    // Merged once and then given another instruction: what it is doing beats
    // what it has done.
    for (const activity of ['working', 'awaiting-permission'] as const) {
      const badge = sessionBadge({ activity, changedFiles: 33, landed: true })
      expect(badge.label).not.toBe('Landed')
    }
  })

  it('leaves an unlanded session reading exactly as before', () => {
    const badge = sessionBadge({
      activity: 'idle',
      changedFiles: 33,
      check: { status: 'passing' } as any,
      behind: 1,
      landed: false,
    })

    expect(badge.label).toBe('Base moved on')
  })
})

describe('when nobody counted the files', () => {
  it('says idle rather than asserting there were no changes', () => {
    // The wall builds tiles without spawning git, so it genuinely does not know.
    expect(sessionBadge({ activity: 'idle', changesUnknown: true }).label).toBe('Idle')
    expect(sessionBadge({ activity: 'idle' }).label).toBe('No changes')
  })

  it('does not suppress a verdict that was recorded', () => {
    const passing = sessionBadge({ activity: 'idle', changesUnknown: true, check: { status: 'passing' } })
    expect(passing.label).toBe('Checks pass')

    const failing = sessionBadge({ activity: 'idle', changesUnknown: true, check: { status: 'failing' } })
    expect(failing.label).toBe('Checks failed')
  })

  it('does not suppress landing, which is the end of the story either way', () => {
    const badge = sessionBadge({ activity: 'idle', changesUnknown: true, landed: true })
    expect(badge.label).toBe('Landed')
  })
})
