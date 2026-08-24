import { describe, expect, it } from 'vitest'
import {
  describeRace, raceFor, raceOf, racesIn, raceSummary, standingLabel, standingOf,
} from '~/utils/race'
import type { Session } from '~/composables/useSessions'

/**
 * Several agents on one instruction.
 *
 * Two failures worth guarding, and only one of them is cosmetic.
 *
 * **Reading an untested diff as a pass.** A stale verdict describes code that has
 * since changed, and a race that called it `passed` would offer to land work
 * nothing has checked — the only mistake in this module that could put broken
 * code in a base branch.
 *
 * **Calling a race decided when it is not.** The first entrant home is not the
 * winner; a second may pass a minute later with the better diff. So `open` has to
 * survive anything still moving, and `nothing` has to be unmistakable when it
 * arrives, because "all of them failed" is the outcome N separate rows hide.
 */

let seq = 0

function entrant(over: Partial<Session> = {}): Session {
  seq += 1
  return {
    id: `s${seq}`,
    title: `Fix the thing · ${seq}`,
    repoDir: '/r',
    worktreePath: `/w${seq}`,
    branch: `b${seq}`,
    baseBranch: 'main',
    baseSha: 'sha',
    status: 'idle',
    activity: 'idle',
    raceId: 'race-1',
    runIds: [],
    createdAt: 0,
    updatedAt: 100,
    pendingPermissions: 0,
    lastRunId: null,
    turnCount: 1,
    inCurrentProject: true,
    worktree: { path: '/w', exists: true, branch: 'b', changedFiles: 0, dirty: false, ahead: 0, behind: 0 },
    ...over,
  } as Session
}

const check = (status: 'passing' | 'failing' | 'errored' | 'running') => ({
  status, command: 'make check', fingerprint: 'f', exitCode: status === 'passing' ? 0 : 1,
  output: '', durationMs: 1, at: 1,
})

/** Passed its checks with something to land: the shape of a candidate. */
const passing = (over: Partial<Session> = {}) => entrant({
  check: check('passing'),
  worktree: { path: '/w', exists: true, branch: 'b', changedFiles: 3, dirty: false, ahead: 2, behind: 0 },
  ...over,
})

describe('where one entrant got to', () => {
  it('is a candidate when its checks pass and it has commits', () => {
    expect(standingOf(passing())).toBe('passed')
  })

  /**
   * The distinction that stops a race being decided by an agent that answered a
   * question. Green checks over an empty worktree is a pass with nothing in it.
   */
  it('is not a candidate when its checks pass but it committed nothing', () => {
    expect(standingOf(entrant({ check: check('passing') }))).toBe('passed-empty')
  })

  /**
   * The one that could land broken code. A stale verdict is about code that has
   * since changed, so it is no verdict — never a pass.
   */
  it('is unknown when the verdict is stale, never passed', () => {
    const stale = passing({ checkStale: true } as Partial<Session>)
    expect(standingOf(stale)).toBe('unknown')
  })

  it('is unknown when the checks have never run, which is not passing', () => {
    expect(standingOf(entrant())).toBe('unknown')
  })

  it('is working while a turn is going, whatever the last verdict said', () => {
    expect(standingOf(passing({ status: 'running' }))).toBe('working')
    expect(standingOf(passing({ activity: 'working' } as Partial<Session>))).toBe('working')
  })

  it('is working while the checks themselves are running', () => {
    expect(standingOf(entrant({ check: check('running') }))).toBe('working')
  })

  it('separates a failed verdict from checks that could not run at all', () => {
    expect(standingOf(entrant({ check: check('failing') }))).toBe('failed')
    expect(standingOf(entrant({ check: check('errored') }))).toBe('errored')
  })

  /**
   * Landed outranks a later red verdict: once the commits are in the base the
   * question this race asked has been answered, and a failing check about the
   * workspace afterwards is a fact about the workspace.
   */
  it('is landed even if the workspace has since gone red', () => {
    expect(standingOf(entrant({ landed: true, check: check('failing') } as Partial<Session>)))
      .toBe('landed')
  })
})

describe('the standings, in order', () => {
  it('puts the candidate first and the unrunnable last', () => {
    const sessions = [
      entrant({ check: check('errored') }),
      passing(),
      entrant({ check: check('failing') }),
    ]

    expect(raceOf(sessions, 'race-1').map(e => e.standing))
      .toEqual(['passed', 'failed', 'errored'])
  })

  it('breaks a tie on commits, so the fuller diff reads first', () => {
    const small = passing({ id: 'small', worktree: { path: '/w', exists: true, branch: 'b', changedFiles: 1, dirty: false, ahead: 1, behind: 0 } })
    const big = passing({ id: 'big', worktree: { path: '/w', exists: true, branch: 'b', changedFiles: 9, dirty: false, ahead: 5, behind: 0 } })

    expect(raceOf([small, big], 'race-1').map(e => e.session.id)).toEqual(['big', 'small'])
  })

  it('takes only the entrants of the race it was asked about', () => {
    const mine = passing({ raceId: 'race-1' })
    const theirs = passing({ raceId: 'race-2' })
    const loner = passing({ raceId: undefined })

    expect(raceOf([mine, theirs, loner], 'race-1').map(e => e.session.id)).toEqual([mine.id])
  })
})

describe('what the race has come to', () => {
  /** Not decided by the first entrant home — a second may yet pass. */
  it('stays open while anything is still working', () => {
    const race = describeRace('r', raceOf([passing(), entrant({ status: 'running' })], 'race-1'))

    expect(race.outcome).toBe('open')
    /*
     * But the one that already passed is still offered. `candidates` is what
     * could be landed; `outcome` is whether waiting longer is worth it. Making
     * somebody wait for the slowest agent before they may take a green diff
     * would be the tool insisting on a comparison they did not ask to finish.
     */
    expect(race.candidates).toHaveLength(1)
  })

  it('is decided once nothing is moving and something is landable', () => {
    const race = describeRace('r', raceOf([passing(), entrant({ check: check('failing') })], 'race-1'))

    expect(race.outcome).toBe('decided')
    expect(race.candidates).toHaveLength(1)
  })

  it('offers every passing entrant, because it does not pick between them', () => {
    const race = describeRace('r', raceOf([passing(), passing()], 'race-1'))

    expect(race.outcome).toBe('decided')
    expect(race.candidates).toHaveLength(2)
  })

  /** The outcome N separate rows in a list hide. */
  it('says nothing came of it when every entrant failed', () => {
    const race = describeRace('r', raceOf(
      [entrant({ check: check('failing') }), entrant({ check: check('errored') })],
      'race-1',
    ))

    expect(race.outcome).toBe('nothing')
    expect(raceSummary(race)).toBe('None of the 2 passed.')
  })

  it('distinguishes "all failed" from "none of them changed anything"', () => {
    const race = describeRace('r', raceOf(
      [entrant({ check: check('passing') }), entrant({ check: check('passing') })],
      'race-1',
    ))

    expect(race.outcome).toBe('nothing')
    expect(raceSummary(race)).toContain('committed anything')
  })

  it('is over once one has landed', () => {
    const race = describeRace('r', raceOf(
      [entrant({ landed: true, provider: 'cursor' } as Partial<Session>), passing()],
      'race-1',
    ))

    expect(race.outcome).toBe('over')
    expect(raceSummary(race)).toBe('Landed — Cursor won this one.')
  })

  it('counts how many are home while it is still open', () => {
    const race = describeRace('r', raceOf(
      [passing(), entrant({ status: 'running' }), entrant({ status: 'running' })],
      'race-1',
    ))

    expect(raceSummary(race)).toBe('1 of 3 finished, the rest still working.')
  })

  it('names the sole winner when only one passed', () => {
    const race = describeRace('r', raceOf(
      [passing({ provider: 'cursor' } as Partial<Session>), entrant({ check: check('failing') })],
      'race-1',
    ))

    expect(raceSummary(race)).toBe('Cursor is the only one that passed.')
  })

  it('sends you to read the diffs when more than one passed', () => {
    const race = describeRace('r', raceOf([passing(), passing()], 'race-1'))
    expect(raceSummary(race)).toBe('2 of 2 passed — read the diffs and pick one.')
  })
})

describe('finding a session\'s race', () => {
  it('is null for an ordinary session, which is nearly all of them', () => {
    const alone = entrant({ raceId: undefined })
    expect(raceFor([alone], alone)).toBeNull()
  })

  it('finds the race a session is one of', () => {
    const a = passing()
    const b = entrant({ check: check('failing') })

    expect(raceFor([a, b], a)?.entrants).toHaveLength(2)
  })

  it('groups several races without mixing them', () => {
    const races = racesIn([
      passing({ raceId: 'r1', updatedAt: 10 }),
      passing({ raceId: 'r1', updatedAt: 20 }),
      passing({ raceId: 'r2', updatedAt: 99 }),
      passing({ raceId: undefined }),
    ])

    expect(races).toHaveLength(2)
    // Newest first, by the most recently touched entrant.
    expect(races[0]!.id).toBe('r2')
    expect(races[1]!.entrants).toHaveLength(2)
  })
})

describe('what a standing says to a reader', () => {
  it('never reads as an instruction, only as a fact', () => {
    const labels = [
      standingLabel({ session: passing(), standing: 'passed', ahead: 2 }),
      standingLabel({ session: entrant(), standing: 'failed', ahead: 1 }),
      standingLabel({ session: entrant(), standing: 'passed-empty', ahead: 0 }),
      standingLabel({ session: entrant(), standing: 'unknown', ahead: 0 }),
    ]

    for (const label of labels) {
      expect(label).not.toMatch(/\b(land|pick|choose|press)\b/i)
    }
  })

  it('counts commits in words a person can check against git', () => {
    expect(standingLabel({ session: passing(), standing: 'passed', ahead: 1 })).toBe('passed · 1 commit')
    expect(standingLabel({ session: passing(), standing: 'passed', ahead: 4 })).toBe('passed · 4 commits')
  })

  it('says an unchecked entrant with commits is unchecked, not empty', () => {
    expect(standingLabel({ session: entrant(), standing: 'unknown', ahead: 3 }))
      .toBe('3 commits, not checked yet')
    expect(standingLabel({ session: entrant(), standing: 'unknown', ahead: 0 }))
      .toBe('nothing yet')
  })
})
