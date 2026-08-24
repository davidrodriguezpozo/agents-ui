import { describe, expect, it } from 'vitest'
import {
  joinOutcomes,
  outcomeTurnOf,
  skillOf,
  turnChangedFiles,
  type OutcomeSession,
  type OutcomeTurn,
} from '../server/utils/outcomes'
import type { RunEvent } from '../server/utils/runStore'
import type { CheckStatus, SessionCheck } from '../server/utils/checks'

/**
 * Was that a good trade.
 *
 * The failures that matter here are all the same failure: a number that reads
 * better than the records support. Spend attributed to a session that never
 * landed, a merge somebody else did counted as this machine's work, an unmeasured
 * turn counted as a turn that changed nothing. So most of these tests are about
 * what the join refuses to claim.
 */

const DAY = 86_400_000
const NOW = new Date(2026, 7, 20, 9, 0, 0).getTime()
const SINCE = NOW - 7 * DAY

let seq = 0

function turn(patch: Partial<OutcomeTurn> = {}): OutcomeTurn {
  return {
    id: `t${seq++}`,
    createdAt: NOW - DAY,
    costUsd: 1,
    source: 'session',
    ...patch,
  }
}

function check(status: CheckStatus): SessionCheck {
  return {
    status,
    command: 'make check',
    fingerprint: 'abc',
    exitCode: status === 'passing' ? 0 : 1,
    output: '',
    durationMs: 1000,
    at: NOW - DAY,
  }
}

function session(patch: Partial<OutcomeSession> = {}): OutcomeSession {
  return {
    id: `s${seq++}`,
    repoDir: '/repo/one',
    status: 'idle',
    ...patch,
  }
}

describe('nothing landed', () => {
  it('reports the spend and refuses to divide by no merges', () => {
    const open = session()
    const report = joinOutcomes({
      turns: [turn({ sessionId: open.id, costUsd: 2 }), turn({ sessionId: open.id, costUsd: 1.5 })],
      sessions: [open],
      since: SINCE,
    })

    expect(report.turns).toBe(2)
    expect(report.costUsd).toBeCloseTo(3.5)
    expect(report.landings).toEqual({ total: 0, merged: 0, pullRequest: 0, elsewhere: 0 })
    // Not zero. A window with no merge has no cost per merge, and a zero here
    // would read as "each merge was free".
    expect(report.costPerLandingUsd).toBeNull()
  })

  it('calls an open session neither a win nor a loss', () => {
    const open = session()
    const report = joinOutcomes({ turns: [turn({ sessionId: open.id })], sessions: [open], since: SINCE })

    expect(report.openCostUsd).toBeCloseTo(1)
    expect(report.landedCostUsd).toBe(0)
    expect(report.abandonedCostUsd).toBe(0)
  })
})

describe('one landing', () => {
  const landed = session({
    id: 'landed',
    landed: { at: NOW - DAY, how: 'merged', into: 'main', commits: 3 },
    check: check('passing'),
  })

  const report = joinOutcomes({
    turns: [
      turn({ sessionId: 'landed', costUsd: 2, changedFiles: true }),
      turn({ sessionId: 'landed', costUsd: 1, changedFiles: false }),
    ],
    sessions: [landed],
    since: SINCE,
  })

  it('counts the route it went in by', () => {
    expect(report.landings).toEqual({ total: 1, merged: 1, pullRequest: 0, elsewhere: 0 })
  })

  it('puts the whole session against the merge, rework included', () => {
    // Both turns. Nothing here can separate the work from the second attempt at
    // it, so the figure is an upper bound and says so.
    expect(report.landedCostUsd).toBeCloseTo(3)
    expect(report.costPerLandingUsd).toBeCloseTo(3)
  })

  it('reports the share of turns that changed files against a stated denominator', () => {
    expect(report.changedFiles).toEqual({ turns: 1, measured: 2, share: 0.5 })
  })

  it('carries the check verdict through', () => {
    expect(report.checks.passing).toBe(1)
    expect(report.checks.unknown).toBe(0)
  })
})

describe('a landing somebody else merged on github.com', () => {
  const theirs = session({ id: 'theirs', landed: { at: NOW - DAY, how: 'elsewhere', pr: 7 } })
  const report = joinOutcomes({
    turns: [turn({ sessionId: 'theirs', costUsd: 4 })],
    sessions: [theirs],
    since: SINCE,
  })

  it('counts it as a landing, because the work was accepted either way', () => {
    expect(report.landings.total).toBe(1)
    expect(report.landedCostUsd).toBeCloseTo(4)
  })

  it('keeps it separate, because this machine did not do it', () => {
    // "It is in" and "we put it in" are different facts, and only one of them is
    // this app taking credit.
    expect(report.landings.elsewhere).toBe(1)
    expect(report.landings.merged).toBe(0)
    expect(report.landings.pullRequest).toBe(0)
  })
})

describe('a landing that did not hold', () => {
  const reverted = {
    at: NOW - 60_000,
    sha: 'f'.repeat(40),
    committedAt: NOW - 120_000,
    subject: 'Revert "Merge session: retry the upload"',
    landedSha: 'a'.repeat(40),
    branch: 'main',
  }

  const took = session({
    id: 'took',
    landed: { at: NOW - 3 * DAY, how: 'merged', into: 'main', sha: 'a'.repeat(40) },
    reverted,
  })
  const held = session({ id: 'held', landed: { at: NOW - 2 * DAY, how: 'merged', into: 'main' } })

  const report = joinOutcomes({
    turns: [
      turn({ sessionId: 'took', costUsd: 5, model: 'sonnet' }),
      turn({ sessionId: 'held', costUsd: 1, model: 'sonnet' }),
    ],
    sessions: [took, held],
    since: SINCE,
  })

  it('is still a merge, because it was one', () => {
    // The cost was spent and the work was accepted. Retracting the merge from the
    // count would make "spend per merge" flatter for the wrong reason.
    expect(report.landings).toEqual({ total: 2, merged: 2, pullRequest: 0, elsewhere: 0 })
    expect(report.landedCostUsd).toBeCloseTo(6)
  })

  it('is counted beside the merges rather than inside them', () => {
    expect(report.revertedLandings).toBe(1)
  })

  it('rides along into the group the merge was counted in', () => {
    expect(report.byModel.find(g => g.key === 'sonnet')?.revertedLandings).toBe(1)
  })

  it('is nothing at all when nothing was reverted', () => {
    const clean = joinOutcomes({
      turns: [turn({ sessionId: 'held' })],
      sessions: [held],
      since: SINCE,
    })

    expect(clean.revertedLandings).toBe(0)
  })

  it('counts against the window the merge is in, not the one the revert is in', () => {
    /*
     * The merge is three days back and the revert is a minute ago. A window
     * ending before the revert still has to report that this merge did not hold:
     * it is a fact about the landing, and the alternative is reporting a merge as
     * having held when it is known not to have.
     */
    const earlier = joinOutcomes({
      turns: [turn({ sessionId: 'took', createdAt: NOW - 3 * DAY, costUsd: 5 })],
      sessions: [took],
      since: NOW - 4 * DAY,
      until: NOW - 2 * DAY,
    })

    expect(earlier.landings.total).toBe(1)
    expect(earlier.revertedLandings).toBe(1)
  })
})

describe('a session set aside', () => {
  it('is spend that produced nothing, and is not hidden among the open work', () => {
    const filed = session({ id: 'filed', filedAt: NOW - 2 * DAY })
    const open = session({ id: 'open' })

    const report = joinOutcomes({
      turns: [turn({ sessionId: 'filed', costUsd: 3 }), turn({ sessionId: 'open', costUsd: 1 })],
      sessions: [filed, open],
      since: SINCE,
    })

    expect(report.abandonedCostUsd).toBeCloseTo(3)
    expect(report.openCostUsd).toBeCloseTo(1)
    expect(report.landedCostUsd).toBe(0)
  })

  it('counts a closed session the same way — somebody decided it was finished', () => {
    const archived = session({ id: 'archived', status: 'archived' })
    const report = joinOutcomes({
      turns: [turn({ sessionId: 'archived', costUsd: 2 })],
      sessions: [archived],
      since: SINCE,
    })

    expect(report.abandonedCostUsd).toBeCloseTo(2)
  })

  it('still counts a set-aside session that had landed as landed', () => {
    // Filed after it shipped is the normal end of a session, not a write-off.
    const done = session({ id: 'done', filedAt: NOW, landed: { at: NOW - DAY, how: 'merged' } })
    const report = joinOutcomes({
      turns: [turn({ sessionId: 'done', costUsd: 2 })],
      sessions: [done],
      since: SINCE,
    })

    expect(report.landedCostUsd).toBeCloseTo(2)
    expect(report.abandonedCostUsd).toBe(0)
  })
})

describe('a day with only side costs', () => {
  const report = joinOutcomes({
    turns: [],
    sessions: [],
    side: [
      { source: 'summary', costUsd: 0.004, at: NOW - DAY },
      { source: 'summary', costUsd: 0.006, at: NOW - DAY },
      // Outside the window, and outside the figure.
      { source: 'summary', costUsd: 5, at: SINCE - DAY },
      // Free, so not activity.
      { source: 'summary', costUsd: 0, at: NOW },
    ],
    since: SINCE,
  })

  it('reports them beside the totals rather than inside them', () => {
    expect(report.side).toEqual({ costUsd: 0.01, calls: 2 })
    expect(report.costUsd).toBe(0)
    expect(report.turns).toBe(0)
  })

  it('says nothing landed rather than nothing happened', () => {
    expect(report.landings.total).toBe(0)
    expect(report.costPerLandingUsd).toBeNull()
    expect(report.changedFiles).toEqual({ turns: 0, measured: 0, share: null })
  })
})

describe('the window', () => {
  it('leaves out turns either side of it', () => {
    const report = joinOutcomes({
      turns: [
        turn({ createdAt: SINCE - 1, costUsd: 9 }),
        turn({ createdAt: SINCE, costUsd: 1 }),
        turn({ createdAt: NOW, costUsd: 1 }),
        turn({ createdAt: NOW + 1, costUsd: 9 }),
      ],
      sessions: [],
      since: SINCE,
      until: NOW,
    })

    expect(report.turns).toBe(2)
    expect(report.costUsd).toBeCloseTo(2)
  })

  it('places a turn by when it began, not when it was asked for', () => {
    // Runs queue per repository, so a turn asked for before the window can
    // start inside it — and that is when the money was spent.
    const report = joinOutcomes({
      turns: [turn({ createdAt: SINCE - DAY, startedAt: SINCE + 60_000, costUsd: 1 })],
      sessions: [],
      since: SINCE,
    })

    expect(report.turns).toBe(1)
  })

  it('leaves out a landing that happened after it', () => {
    const later = session({ id: 'later', landed: { at: NOW + DAY, how: 'merged' } })
    const report = joinOutcomes({
      turns: [turn({ sessionId: 'later' })],
      sessions: [later],
      since: SINCE,
      until: NOW,
    })

    expect(report.landings.total).toBe(0)
    // The spend is still the spend of a session that landed; only the merge is
    // outside the window.
    expect(report.landedCostUsd).toBeCloseTo(1)
  })

  it('does not read a session with no landing as one that landed at the beginning of time', () => {
    const report = joinOutcomes({ turns: [], sessions: [session(), session()], since: 0 })

    expect(report.landings.total).toBe(0)
  })
})

describe('spend nothing owns', () => {
  it('keeps ritual and command runs out of the landed maths entirely', () => {
    const report = joinOutcomes({
      turns: [
        turn({ source: 'ritual', scheduleId: 'morning', sessionId: undefined, costUsd: 0.5 }),
        turn({ source: 'command', sessionId: undefined, costUsd: 0.25 }),
      ],
      sessions: [],
      since: SINCE,
    })

    expect(report.unattributedCostUsd).toBeCloseTo(0.75)
    expect(report.landedCostUsd).toBe(0)
    expect(report.openCostUsd).toBe(0)
  })

  it('treats a turn whose session record is gone as unattributable, not as open work', () => {
    const report = joinOutcomes({
      turns: [turn({ sessionId: 'deleted', costUsd: 1 })],
      sessions: [],
      since: SINCE,
    })

    expect(report.unattributedCostUsd).toBeCloseTo(1)
  })

  it('adds the four buckets back up to the total', () => {
    const landed = session({ id: 'a', landed: { at: NOW - DAY, how: 'pull-request', pr: 3 } })
    const filed = session({ id: 'b', filedAt: NOW })
    const open = session({ id: 'c' })

    const report = joinOutcomes({
      turns: [
        turn({ sessionId: 'a', costUsd: 1 }),
        turn({ sessionId: 'b', costUsd: 2 }),
        turn({ sessionId: 'c', costUsd: 3 }),
        turn({ source: 'ritual', scheduleId: 'r', costUsd: 4 }),
      ],
      sessions: [landed, filed, open],
      since: SINCE,
    })

    const sum = report.landedCostUsd + report.abandonedCostUsd + report.openCostUsd
      + report.unattributedCostUsd
    expect(sum).toBeCloseTo(report.costUsd)
  })
})

describe('what the checks said', () => {
  it('counts a session with no verdict as unknown rather than as passing', () => {
    const never = session({ id: 'never' })
    const report = joinOutcomes({ turns: [turn({ sessionId: 'never' })], sessions: [never], since: SINCE })

    expect(report.checks).toMatchObject({ unknown: 1, passing: 0, failing: 0 })
  })

  it('keeps "could not be run" apart from "failed"', () => {
    const broken = session({ id: 'broken', check: check('errored') })
    const failing = session({ id: 'failing', check: check('failing') })

    const report = joinOutcomes({
      turns: [turn({ sessionId: 'broken' }), turn({ sessionId: 'failing' })],
      sessions: [broken, failing],
      since: SINCE,
    })

    expect(report.checks).toMatchObject({ errored: 1, failing: 1 })
  })

  it('counts a merge that went in over a failing check', () => {
    const forced = session({
      id: 'forced',
      check: check('failing'),
      landed: { at: NOW - DAY, how: 'merged', into: 'main', overrodeChecks: true },
    })

    const report = joinOutcomes({
      turns: [turn({ sessionId: 'forced' })],
      sessions: [forced],
      since: SINCE,
    })

    expect(report.checks.landedOverFailing).toBe(1)
  })

  it('leaves out a session nobody touched in this window', () => {
    // Its verdict is about code this window did not produce; counting it would
    // make a quiet week look like a week of passing tests.
    const untouched = session({ id: 'untouched', check: check('passing') })
    const report = joinOutcomes({ turns: [], sessions: [untouched], since: SINCE })

    expect(report.checks).toMatchObject({ passing: 0, unknown: 0 })
  })
})

describe('grouped six ways', () => {
  const sessions = [
    session({ id: 'one', repoDir: '/repo/one', landed: { at: NOW - DAY, how: 'merged', into: 'main' } }),
    session({ id: 'two', repoDir: '/repo/two' }),
  ]

  const report = joinOutcomes({
    turns: [
      turn({ sessionId: 'one', costUsd: 2, model: 'opus', agentSlug: 'reviewer', invocation: '/hd:review' }),
      turn({ sessionId: 'two', costUsd: 1, model: 'sonnet' }),
      turn({ source: 'ritual', scheduleId: 'morning', costUsd: 0.5, model: 'sonnet', projectDir: '/repo/two' }),
    ],
    sessions,
    since: SINCE,
  })

  it('groups spend by ritual', () => {
    expect(report.byRitual).toHaveLength(1)
    expect(report.byRitual[0]).toMatchObject({ key: 'morning', turns: 1 })
    expect(report.byRitual[0]!.costUsd).toBeCloseTo(0.5)
  })

  it('groups by agent, by model and by skill', () => {
    expect(report.byAgent.map(g => g.key)).toEqual(['reviewer'])
    expect(report.byModel.map(g => g.key)).toEqual(['opus', 'sonnet'])
    expect(report.bySkill.map(g => g.key)).toEqual(['hd:review'])
  })

  it('takes a repository from the session, and from the run when there is no session', () => {
    expect(report.byRepository.map(g => g.key)).toEqual(['/repo/one', '/repo/two'])
    expect(report.byRepository.find(g => g.key === '/repo/two')!.costUsd).toBeCloseTo(1.5)
  })

  it('largest spend first', () => {
    expect(report.byModel[0]!.key).toBe('opus')
    expect(report.byModel[0]!.costUsd).toBeCloseTo(2)
    expect(report.byModel[1]!.costUsd).toBeCloseTo(1.5)
  })

  it('leaves a turn out of a dimension it has no value for', () => {
    // Rather than inventing an "unknown" bucket, which reads like a real ritual
    // with a bad name. The groups can therefore sum to less than the total.
    const grouped = report.byModel.reduce((sum, group) => sum + group.costUsd, 0)
    const skilled = report.bySkill.reduce((sum, group) => sum + group.costUsd, 0)

    expect(grouped).toBeCloseTo(report.costUsd)
    expect(skilled).toBeLessThan(report.costUsd)
  })

  it('files a landing under the group of the last hand on it, once', () => {
    const twoModels = joinOutcomes({
      turns: [
        turn({ sessionId: 'one', costUsd: 1, model: 'opus', createdAt: NOW - 2 * DAY }),
        turn({ sessionId: 'one', costUsd: 1, model: 'sonnet', createdAt: NOW - DAY }),
      ],
      sessions: [sessions[0]!],
      since: SINCE,
    })

    const landings = twoModels.byModel.map(g => [g.key, g.landings.total] as const)
    expect(landings).toContainEqual(['sonnet', 1])
    expect(landings).toContainEqual(['opus', 0])
    expect(twoModels.landings.total).toBe(1)
  })
})

/**
 * Who did this.
 *
 * The failure to guard here is one specific one, and it is worse than a wrong
 * number: a turn nobody signed reading as the person looking at the page. Every
 * ritual is unsigned, and so is every record written before identity existed, so
 * this is not an edge case — it is most of the run log on the day the field
 * ships.
 */
describe('by person', () => {
  const ada = 'ada@example.com'
  const grace = 'grace@example.com'

  it('leaves an unsigned turn out of the person column rather than in a row', () => {
    // Not pooled into "unattributed" either: a row at the top of a table of
    // colleagues reads as one of them, with a strange name and a large bill.
    const open = session({ id: 'open' })
    const report = joinOutcomes({
      turns: [
        turn({ sessionId: 'open', costUsd: 2, person: ada }),
        turn({ sessionId: 'open', costUsd: 3 }),
      ],
      sessions: [open],
      since: SINCE,
    })

    expect(report.byPerson.map(g => g.key)).toEqual([ada])
    expect(report.byPerson[0]!.costUsd).toBeCloseTo(2)
    // The gap is real and is the honest shape of the records.
    expect(report.costUsd).toBeCloseTo(5)
  })

  it('has nobody at all when nothing in the window was signed', () => {
    const nightly = joinOutcomes({
      turns: [turn({ source: 'ritual', scheduleId: 'morning', costUsd: 4 })],
      sessions: [],
      since: SINCE,
    })

    expect(nightly.byPerson).toEqual([])
    expect(nightly.byRitual).toHaveLength(1)
  })

  it('splits a session two people worked on, and counts its merge once', () => {
    /*
     * The case the column exists for. Ada starts it, Grace finishes it, and the
     * merge belongs to whoever had it last — the same rule every other dimension
     * uses, which is what keeps a group's spend and a group's merges describing
     * the same work.
     */
    const shared = session({
      id: 'shared',
      landed: { at: NOW - DAY, how: 'merged', into: 'main' },
    })

    const report = joinOutcomes({
      turns: [
        turn({ sessionId: 'shared', costUsd: 3, person: ada, createdAt: NOW - 3 * DAY }),
        turn({ sessionId: 'shared', costUsd: 1, person: grace, createdAt: NOW - DAY }),
      ],
      sessions: [shared],
      since: SINCE,
    })

    expect(report.byPerson.map(g => g.key)).toEqual([ada, grace])
    expect(report.byPerson.find(g => g.key === ada)!.costUsd).toBeCloseTo(3)
    expect(report.byPerson.find(g => g.key === ada)!.landings.total).toBe(0)
    expect(report.byPerson.find(g => g.key === grace)!.landings.total).toBe(1)
    expect(report.landings.total).toBe(1)
  })

  it('never stands the session in for a turn that named nobody', () => {
    // Unlike the agent, which falls back to the session's. A session started by
    // one person and continued by another is exactly this dimension's subject,
    // and falling back would file the second person's turns under the first.
    const shared = session({ id: 'shared', agentSlug: 'reviewer' })
    const report = joinOutcomes({
      turns: [turn({ sessionId: 'shared', costUsd: 1 })],
      sessions: [shared],
      since: SINCE,
    })

    expect(report.byPerson).toEqual([])
    expect(report.byAgent.map(g => g.key)).toEqual(['reviewer'])
  })

  it('takes the key off the run record, one person per spelling of their email', () => {
    const one = outcomeTurnOf({
      id: 'r1', title: 't', kind: 'chat', status: 'completed', createdAt: NOW - DAY,
      by: { name: 'Ada Lovelace', email: 'Ada@Example.com' },
    })
    const two = outcomeTurnOf({
      id: 'r2', title: 't', kind: 'chat', status: 'completed', createdAt: NOW - DAY,
      by: { name: 'A. Lovelace', email: 'ada@example.com' },
    })

    expect(one.person).toBe(ada)
    expect(two.person).toBe(ada)
  })

  it('has no person for a run record written before identity existed', () => {
    const older = outcomeTurnOf({
      id: 'r0', title: 't', kind: 'chat', status: 'completed', createdAt: NOW - DAY,
    })

    expect(older.person).toBeUndefined()
  })
})

describe('turnChangedFiles', () => {
  let eventSeq = 0
  const event = (type: RunEvent['type'], rest: Record<string, unknown> = {}): RunEvent =>
    ({ seq: eventSeq++, at: NOW, type, ...rest })

  it('is true when the turn wrote a file', () => {
    expect(turnChangedFiles([
      event('tool_use', { id: 'a', toolName: 'Read' }),
      event('tool_use', { id: 'b', toolName: 'Edit' }),
      event('tool_result', { id: 'b' }),
    ])).toBe(true)
  })

  it('is false for a turn that only read and ran things', () => {
    expect(turnChangedFiles([
      event('tool_use', { id: 'a', toolName: 'Read' }),
      event('tool_use', { id: 'b', toolName: 'Bash' }),
      event('text', { text: 'nothing to change here' }),
    ])).toBe(false)
  })

  it('does not count an edit that came back an error', () => {
    // The file is unchanged; counting it would credit the turn with work it did
    // not do.
    expect(turnChangedFiles([
      event('tool_use', { id: 'a', toolName: 'Write' }),
      event('tool_result', { id: 'a', isError: true }),
    ])).toBe(false)
  })

  it('counts an edit whose result never arrived', () => {
    // A turn cut off after writing a file has still written the file.
    expect(turnChangedFiles([event('tool_use', { id: 'a', toolName: 'MultiEdit' })])).toBe(true)
  })

  it('is false with no events at all', () => {
    expect(turnChangedFiles()).toBe(false)
  })
})

describe('skillOf', () => {
  it('takes the invocation when something in the app knew it', () => {
    expect(skillOf({ invocation: '/hd:goodmorning' })).toBe('hd:goodmorning')
    expect(skillOf({ invocation: 'review' })).toBe('review')
  })

  it('reads a slash command typed by hand out of the prompt', () => {
    expect(skillOf({ input: '/code-review the diff on this branch' })).toBe('code-review')
  })

  it('has no skill for ordinary prose', () => {
    expect(skillOf({ input: 'have a look at the failing test' })).toBeUndefined()
    expect(skillOf({})).toBeUndefined()
    // A path is not a skill.
    expect(skillOf({ input: '/Users/me/repo' })).toBeUndefined()
  })
})

describe('outcomeTurnOf', () => {
  const record = {
    id: 'r1',
    title: 'A turn',
    kind: 'chat',
    status: 'completed',
    createdAt: NOW - DAY,
    sessionId: 's1',
    stats: { costUsd: 0.4, model: 'claude-opus-5' },
    events: [{ seq: 0, at: NOW, type: 'tool_use' as const, id: 'x', toolName: 'Write' }],
  }

  it('digs the cost and the model out of stats, and works out the source', () => {
    expect(outcomeTurnOf(record)).toMatchObject({
      costUsd: 0.4,
      model: 'claude-opus-5',
      source: 'session',
      changedFiles: true,
    })
  })

  it('leaves changedFiles unsaid when the events were never loaded', () => {
    // Unmeasured, not unchanged — the denominator has to be able to tell.
    expect(outcomeTurnOf({ ...record, events: undefined }).changedFiles).toBeUndefined()
  })
})

/**
 * A merge whose price nobody here can know.
 *
 * The failure this guards against is the flattering kind, and it is the one the
 * provider seam introduced: an agent that reports no cost adds landings to the
 * denominator of cost-per-landing and nothing to the numerator, so the headline
 * figure would fall every time one merged. The number would improve while
 * nothing about the work had — which is worse than a blank, because a blank
 * makes somebody go and look.
 */
describe('a landing whose cost is not knowable', () => {
  it('counts the merge, because the work landed either way', () => {
    const landed = session({ landed: { at: NOW - DAY, how: 'merged', into: 'main' } })
    const report = joinOutcomes({
      turns: [turn({ sessionId: landed.id, costUsd: 0, costReported: false })],
      sessions: [landed],
      since: SINCE,
    })

    expect(report.landings.total).toBe(1)
    expect(report.landings.merged).toBe(1)
  })

  it('keeps it out of cost per landing, and says how many it left out', () => {
    const landed = session({ landed: { at: NOW - DAY, how: 'merged', into: 'main' } })
    const report = joinOutcomes({
      turns: [turn({ sessionId: landed.id, costUsd: 0, costReported: false })],
      sessions: [landed],
      since: SINCE,
    })

    // One merge, none of it costable: there is no average to report.
    expect(report.costPerLandingUsd).toBeNull()
    expect(report.landingsWithoutCost).toBe(1)
    expect(report.uncostedTurns).toBe(1)
  })

  /** The point of the whole thing: the figure must not fall for a bad reason. */
  it('does not drag the average down when it lands beside a costed one', () => {
    const costed = session({ id: 'costed', landed: { at: NOW - DAY, how: 'merged', into: 'main' } })
    const free = session({ id: 'free', landed: { at: NOW - DAY, how: 'merged', into: 'main' } })

    const report = joinOutcomes({
      turns: [
        turn({ sessionId: costed.id, costUsd: 6 }),
        turn({ sessionId: free.id, costUsd: 0, costReported: false }),
      ],
      sessions: [costed, free],
      since: SINCE,
    })

    expect(report.landings.total).toBe(2)
    expect(report.landingsWithoutCost).toBe(1)
    // $6 over the one merge it can account for — not $3 over two.
    expect(report.costPerLandingUsd).toBeCloseTo(6)
  })

  /**
   * The load-bearing default. Every turn recorded before there was a second
   * agent says nothing about whether its cost was reported, and all of them
   * were — reading absence as "unreported" would empty the figure for every
   * record on disk.
   */
  it('reads a turn that says nothing as one whose cost was reported', () => {
    const landed = session({ landed: { at: NOW - DAY, how: 'merged', into: 'main' } })
    const report = joinOutcomes({
      turns: [turn({ sessionId: landed.id, costUsd: 4 })],
      sessions: [landed],
      since: SINCE,
    })

    expect(report.landingsWithoutCost).toBe(0)
    expect(report.uncostedTurns).toBe(0)
    expect(report.costPerLandingUsd).toBeCloseTo(4)
  })

  /**
   * A Claude turn really can cost nothing — cached, instant, or refused before
   * it did anything. That is a *measured* zero and belongs in the average, which
   * is why the question is asked of the provider rather than of the number.
   */
  it('keeps a genuinely free costed turn in the average', () => {
    const landed = session({ landed: { at: NOW - DAY, how: 'merged', into: 'main' } })
    const report = joinOutcomes({
      turns: [turn({ sessionId: landed.id, costUsd: 0, costReported: true })],
      sessions: [landed],
      since: SINCE,
    })

    expect(report.landingsWithoutCost).toBe(0)
    expect(report.costPerLandingUsd).toBe(0)
  })

  /**
   * The same rule catches something that predates providers: a session that
   * landed in this window having done all its work before it has no turn here to
   * cost either. It was already contributing nothing to the numerator while
   * sitting in the denominator, understating cost per merge in exactly the same
   * direction.
   */
  it('also leaves out a landing whose work happened before the window', () => {
    const earlier = session({ landed: { at: NOW - DAY, how: 'merged', into: 'main' } })
    const report = joinOutcomes({
      // The only turn is older than the window, so it is filtered out entirely.
      turns: [turn({ sessionId: earlier.id, createdAt: SINCE - DAY, costUsd: 9 })],
      sessions: [earlier],
      since: SINCE,
    })

    expect(report.landings.total).toBe(1)
    expect(report.landingsWithoutCost).toBe(1)
    expect(report.costPerLandingUsd).toBeNull()
  })
})

/**
 * The provider is read off the run rather than guessed from its cost, so a
 * record's own account of which agent ran it is what decides this.
 */
describe('reading whether a run reports its cost', () => {
  it('treats a run with no provider as one that does', () => {
    expect(outcomeTurnOf({
      id: 'r1', title: 't', kind: 'chat', status: 'completed', createdAt: NOW,
    }).costReported).toBe(true)
  })

  it('treats a Cursor run as one that does not', () => {
    expect(outcomeTurnOf({
      id: 'r2', title: 't', kind: 'chat', status: 'completed', createdAt: NOW, provider: 'cursor',
    }).costReported).toBe(false)
  })
})
