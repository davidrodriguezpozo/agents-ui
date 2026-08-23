import { describe, it, expect } from 'vitest'
import {
  buildWorkList, fromRun, fromSession, onTab, removableRuns, statusCounts, tabCounts, tabOf,
  type WorkItem,
} from '~/utils/workList'
import type { Session } from '~/composables/useSessions'
import type { RunSummary } from '~/composables/useRuns'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'a', title: 'a session', repoDir: '/r', worktreePath: '/w',
    branch: 'feature-a', baseBranch: 'main', baseSha: 'sha',
    status: 'idle', runIds: [], createdAt: 0, updatedAt: 100,
    activity: 'idle', pendingPermissions: 0, lastRunId: null, turnCount: 2,
    inCurrentProject: true,
    worktree: { path: '/w', exists: true, branch: 'feature-a', changedFiles: 0, dirty: false, ahead: 0, behind: 0 },
    ...over,
  } as Session
}

function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'r1', kind: 'command', title: 'a run', status: 'completed',
    createdAt: 0, preview: '', source: 'ritual',
    ...over,
  } as RunSummary
}

const changed = { path: '/w', exists: true, branch: 'b', changedFiles: 4, dirty: false, ahead: 1, behind: 0 }

const outcomes = (items: WorkItem[]) => items.map(i => i.outcome)

describe('a row is a piece of work, not a turn', () => {
  it('drops runs that belong to a session, because the session is its own row', () => {
    // The old Activity list showed a four-turn session four times, competing
    // with itself.
    const items = buildWorkList({
      sessions: [session({ id: 'x', title: 'the session' })],
      runs: [
        run({ id: 'r1', source: 'session', sessionId: 'x', title: 'turn 1' }),
        run({ id: 'r2', source: 'session', sessionId: 'x', title: 'turn 2' }),
      ],
    })
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('the session')
  })

  it('keeps a run that no session owns', () => {
    const items = buildWorkList({ sessions: [], runs: [run({ source: 'ritual' })] })
    expect(items.map(i => i.origin)).toEqual(['ritual'])
  })

  it('leaves archived sessions out', () => {
    const items = buildWorkList({ sessions: [session({ status: 'archived' })], runs: [] })
    expect(items).toEqual([])
  })
})

describe('a session says where it got to in its own words', () => {
  it('separates work waiting to land from work that produced nothing', () => {
    // The distinction the whole sessions list exists for, and the one a shared
    // status enum would have flattened. `nothing` is dated 1970 by the factory,
    // so it has aged out; a fresh one is a conversation, and tested below.
    const ready = fromSession(session({ worktree: changed }))
    const nothing = fromSession(session())

    expect([ready.status, ready.outcome]).toEqual(['yours', 'Ready to land'])
    expect([nothing.status, nothing.outcome]).toEqual(['done', 'Nothing came of it'])
  })

  it('says merged once it is in the base branch', () => {
    expect(fromSession(session({ worktree: changed, landed: true })).outcome).toBe('Merged')
  })

  it('says a revert took it back out, rather than only that it merged', () => {
    // The branch is still contained in the base — that is what a revert leaves
    // behind — so "Merged" on its own is a row claiming main has the change.
    const item = fromSession(session({
      worktree: changed,
      landed: true,
      reverted: { at: 1, sha: 'a', committedAt: 1, subject: 'Revert', landedSha: 'b', branch: 'feature-a' },
    } as Partial<Session>))
    expect(item.outcome).toBe('Merged, then reverted')
  })

  it('tells a blocked permission apart from a failed turn and a failing check', () => {
    expect(fromSession(session({ activity: 'awaiting-permission' })).outcome).toBe('Waiting for permission')
    expect(fromSession(session({ activity: 'failed' })).outcome).toBe('Its last turn failed')
    expect(fromSession(session({ check: { status: 'failing' } } as Partial<Session>)).outcome).toBe('Checks fail')
  })

  it('calls a failed turn a failure, and a failing check something that needs you', () => {
    expect(fromSession(session({ activity: 'failed' })).status).toBe('failed')
    expect(fromSession(session({ check: { status: 'failing' } } as Partial<Session>)).status).toBe('needs-you')
  })

  it('reports a missing workspace without calling it a failure', () => {
    const item = fromSession(session({ activity: 'missing' }))
    expect([item.status, item.outcome]).toEqual(['done', 'Workspace gone'])
  })
})

/**
 * The bug this exists for: a session that answered a question and is waiting for
 * the follow-up had every automatic mark of being over — no live process, no
 * commits, no pull request — and so was filed under History, which is where you
 * go to read about things rather than to do them.
 */
describe('a session waiting on you is still in flight', () => {
  const fresh = (over: Partial<Session> = {}) => session({ updatedAt: Date.now(), ...over })

  it('keeps a session that answered and changed nothing on the flight tab', () => {
    const item = fromSession(fresh())
    expect([item.status, item.outcome]).toEqual(['yours', 'Your turn'])
    expect(tabOf(item.status)).toBe('flight')
  })

  it('keeps work waiting to be merged there too, however quiet it has gone', () => {
    // Twelve uncommitted files and no process running is the most in-flight a
    // session gets, and it used to read as finished.
    const item = fromSession(fresh({ worktree: changed }))
    expect([item.status, item.outcome]).toEqual(['yours', 'Ready to land'])
    expect(tabOf(item.status)).toBe('flight')
  })

  it('does not need a pull request to count as live', () => {
    expect(fromSession(fresh({ worktree: changed, prUrl: undefined })).status).toBe('yours')
  })

  /**
   * Merged is not the end of a session, only of its work.
   *
   * This used to go straight to History, which is right about the commits and
   * wrong about everything else: the worktree, the branch and a whole checkout
   * of the repository are still on disk, and nothing on any screen said so. So
   * it stays on the rail, in a group of its own, until you close it.
   */
  it('moves a merged session to Done rather than out of sight', () => {
    const item = fromSession(fresh({ worktree: changed, landed: true }))
    expect([item.status, item.outcome]).toEqual(['landed', 'Merged'])
    expect(tabOf(item.status)).toBe('flight')
  })

  it('stops calling a merged session your turn, whatever its checks said', () => {
    // The bug: merge a session and it was still listed as work waiting to land,
    // being told its base had moved on — by the commit that merged it.
    const passing = fromSession(fresh({ worktree: changed, landed: true, check: { status: 'passing' } } as Partial<Session>))
    expect(passing.status).toBe('landed')

    // A local failure over code that has already shipped is not a decision
    // anybody has left to make either. Same rank `sessionBadge` gives `landed`.
    const failing = fromSession(fresh({ worktree: changed, landed: true, check: { status: 'failing' } } as Partial<Session>))
    expect(failing.status).toBe('landed')
  })

  it('lets a merged session back in flight when it is working again', () => {
    // You carried on in it. What is happening now outranks what has landed.
    const working = fromSession(fresh({ worktree: changed, landed: true, activity: 'working' }))
    expect([working.status, working.outcome]).toEqual(['running', 'Working'])

    const asking = fromSession(fresh({ worktree: changed, landed: true, activity: 'awaiting-permission' }))
    expect(asking.status).toBe('needs-you')
  })

  it('lets go of a merged session once you say you are done with it', () => {
    const item = fromSession(fresh({ worktree: changed, landed: true, filedAt: Date.now() }))
    expect([item.status, item.outcome]).toEqual(['done', 'Merged'])
    expect(tabOf(item.status)).toBe('history')
  })

  it('files a merged session whose workspace is gone, since there is nothing to close', () => {
    const item = fromSession(fresh({ landed: true, activity: 'missing' }))
    expect(tabOf(item.status)).toBe('history')
  })

  it('lets go when you say you are done with it, whatever is in the workspace', () => {
    const aside = fromSession(fresh({ worktree: changed, filedAt: Date.now() }))
    expect([aside.status, aside.outcome]).toEqual(['done', 'Set aside'])
    expect(tabOf(aside.status)).toBe('history')

    const empty = fromSession(fresh({ filedAt: Date.now() }))
    expect([empty.status, empty.outcome]).toEqual(['done', 'Set aside'])
  })

  it('ages an empty session out on its own, so the tab cannot silt up', () => {
    const stale = fromSession(session({ updatedAt: Date.now() - 8 * 24 * 3600_000 }))
    expect([stale.status, stale.outcome]).toEqual(['done', 'Nothing came of it'])
  })

  it('never ages out a session with work sitting in it', () => {
    // Filing that away quietly a week later is the same bug, just slower.
    const old = fromSession(session({
      updatedAt: Date.now() - 40 * 24 * 3600_000,
      worktree: changed,
    }))
    expect(old.status).toBe('yours')
  })

  it('sorts your turn below what is running and above what is over', () => {
    const items = buildWorkList({
      sessions: [fresh({ id: 'mine', title: 'your turn' })],
      runs: [
        run({ id: 'r-run', status: 'running', title: 'running' }),
        run({ id: 'r-done', status: 'completed', title: 'over' }),
      ],
    })
    expect(items.map(i => i.title)).toEqual(['running', 'your turn', 'over'])
  })
})

describe('a run says where it got to in its own', () => {
  it('tells running apart from waiting its turn', () => {
    expect(fromRun(run({ status: 'running' })).outcome).toBe('Running')
    expect(fromRun(run({ status: 'queued' })).outcome).toBe('Waiting its turn')
    expect(fromRun(run({ status: 'queued' })).status).toBe('running')
  })

  it('does not call running out of room a failure, or something it needed you for', () => {
    // It needed more room, not a decision — but it also did not finish, so it
    // is not done either.
    const turns = fromRun(run({ stoppedBy: 'turns' }))
    expect([turns.status, turns.outcome]).toEqual(['needs-you', 'Ran out of turns'])

    const budget = fromRun(run({ stoppedBy: 'budget' }))
    expect(budget.outcome).toBe('Reached the spending limit')
  })

  it('treats a refused tool as needing you even though the run reports completed', () => {
    const item = fromRun(run({ status: 'completed', deniedTools: ['Bash(gh:*)'] }))
    expect([item.status, item.outcome]).toEqual(['needs-you', 'Needed you'])
  })

  it('says who stopped it', () => {
    expect(fromRun(run({ status: 'cancelled' })).outcome).toBe('Stopped by you')
    expect(fromRun(run({ status: 'failed' })).outcome).toBe('Failed')
  })

  it('dates a run by when it ended, falling back to when it began', () => {
    expect(fromRun(run({ createdAt: 1, startedAt: 2, completedAt: 3 })).at).toBe(3)
    expect(fromRun(run({ createdAt: 1, startedAt: 2 })).at).toBe(2)
    expect(fromRun(run({ createdAt: 1 })).at).toBe(1)
  })
})

describe('ordering', () => {
  it('puts what is stuck above what is merely recent', () => {
    const items = buildWorkList({
      sessions: [
        session({ id: 'old', title: 'blocked ages ago', updatedAt: 1, activity: 'awaiting-permission' }),
        session({ id: 'new', title: 'finished just now', updatedAt: 999, worktree: changed }),
      ],
      runs: [],
    })
    expect(items.map(i => i.title)).toEqual(['blocked ages ago', 'finished just now'])
  })

  it('ranks needs-you above failed above running above done', () => {
    const items = buildWorkList({
      sessions: [],
      runs: [
        run({ id: '1', status: 'completed', title: 'done' }),
        run({ id: '2', status: 'running', title: 'running' }),
        run({ id: '3', status: 'failed', title: 'failed' }),
        run({ id: '4', status: 'completed', needsAttention: true, title: 'needs you' }),
      ],
    })
    expect(items.map(i => i.title)).toEqual(['needs you', 'failed', 'running', 'done'])
  })

  it('breaks ties by recency, newest first', () => {
    const items = buildWorkList({
      sessions: [],
      runs: [
        run({ id: '1', completedAt: 10, title: 'older' }),
        run({ id: '2', completedAt: 90, title: 'newer' }),
      ],
    })
    expect(items.map(i => i.title)).toEqual(['newer', 'older'])
  })
})

describe('filters', () => {
  const input = {
    sessions: [
      session({ id: 's1', title: 'faceted search', worktree: changed }),
      session({ id: 's2', title: 'blocked thing', activity: 'awaiting-permission' }),
    ],
    runs: [run({ id: 'r1', source: 'ritual', title: 'morning brief' })],
  }

  it('filters by the coarse status', () => {
    expect(buildWorkList(input, { status: 'needs-you' }).map(i => i.title)).toEqual(['blocked thing'])
    // Unmerged work in a live workspace is `yours`, not `done` — it is waiting
    // on you, which is the distinction the fifth status exists to make.
    expect(buildWorkList(input, { status: 'yours' }).map(i => i.title)).toEqual(['faceted search'])
    expect(buildWorkList(input, { status: 'done' }).map(i => i.title)).toEqual(['morning brief'])
  })

  it('filters by what started it', () => {
    expect(buildWorkList(input, { origin: 'ritual' }).map(i => i.title)).toEqual(['morning brief'])
    expect(buildWorkList(input, { origin: 'session' })).toHaveLength(2)
  })

  it('searches sessions here, and trusts the server to have searched the runs', () => {
    // The runs arrive already narrowed, so re-filtering them client-side would
    // search one capped page and silently drop matches beyond it.
    const items = buildWorkList(input, { query: 'faceted' })
    expect(items.map(i => i.title)).toEqual(['faceted search', 'morning brief'])
  })

  it('searches what a session did, not only its title', () => {
    const items = buildWorkList({
      sessions: [session({ summary: { text: 'Added three tests', fingerprint: 'f', costUsd: 0 } } as Partial<Session>)],
      runs: [],
    }, { query: 'three tests' })
    expect(items).toHaveLength(1)
  })

  it('combines status and origin', () => {
    expect(buildWorkList(input, { status: 'yours', origin: 'session' }).map(i => i.title))
      .toEqual(['faceted search'])
    expect(buildWorkList(input, { status: 'done', origin: 'session' })).toHaveLength(0)
  })
})

describe('statusCounts', () => {
  it('counts every status, including the empty ones', () => {
    const items = buildWorkList({
      sessions: [session({ activity: 'awaiting-permission' })],
      runs: [run({ status: 'running' })],
    })
    expect(statusCounts(items)).toEqual({
      running: 1, 'needs-you': 1, yours: 0, landed: 0, done: 0, failed: 0,
    })
  })
})

describe('addressing a row in order to remove it', () => {
  it('carries the run id, so removing does not mean taking the key apart', () => {
    const item = fromRun(run({ id: 'run-abc' }))
    expect(item.runId).toBe('run-abc')
    expect(item.key).toBe('run:run-abc')
  })

  it('carries whether it has already been removed, so it can be put back', () => {
    expect(fromRun(run({ hiddenAt: 1_700_000_000_000 })).hiddenAt)
      .toBe(1_700_000_000_000)
    expect(fromRun(run()).hiddenAt).toBeUndefined()
  })

  it('gives a session row no run id, because there is no run to remove', () => {
    // A session's rows are the session; removing one would have to mean deleting
    // a worktree, which is a different act with a different confirmation.
    const item = buildWorkList({ sessions: [session()], runs: [] })[0]!
    expect(item.runId).toBeUndefined()
  })
})

describe('what a bulk clear is allowed to take', () => {
  it('takes finished runs', () => {
    const items = [fromRun(run({ id: 'a', status: 'completed' })), fromRun(run({ id: 'b', status: 'failed' }))]
    expect(removableRuns(items).map(i => i.runId)).toEqual(['a', 'b'])
  })

  it('leaves a run that is still going', () => {
    // Removing something in flight reads as cancelling it, and it is not: the run
    // carries on and its result lands where nobody is looking.
    const items = [fromRun(run({ id: 'a', status: 'running' })), fromRun(run({ id: 'b', status: 'queued' }))]
    expect(removableRuns(items)).toEqual([])
  })

  it('never takes a session', () => {
    // A session is not a run; removing one would mean deleting a worktree.
    const items = buildWorkList({ sessions: [session()], runs: [] })
    expect(removableRuns(items)).toEqual([])
  })

  it('takes only from the list it is given, which is the filtered one', () => {
    const shown = [fromRun(run({ id: 'shown', status: 'failed' }))]
    expect(removableRuns(shown).map(i => i.runId)).toEqual(['shown'])
  })
})

describe('which half of /work a row belongs to', () => {
  it('puts what you could still interrupt on one tab and what is over on the other', () => {
    expect(tabOf('running')).toBe('flight')
    expect(tabOf('needs-you')).toBe('flight')
    expect(tabOf('yours')).toBe('flight')
    expect(tabOf('done')).toBe('history')
    expect(tabOf('failed')).toBe('history')
  })

  it('covers every status, so no row can fall between the two tabs', () => {
    // A status added later and forgotten would make rows invisible on both
    // tabs, which is far worse than showing them on the wrong one.
    const items = [
      fromRun(run({ id: 'r-run', status: 'running' })),
      fromRun(run({ id: 'r-done', status: 'completed' })),
      fromRun(run({ id: 'r-fail', status: 'failed' })),
      fromSession(session({ id: 'blocked', activity: 'awaiting-permission' })),
      fromSession(session({ id: 'yours', updatedAt: Date.now() })),
    ]
    const split = [...onTab(items, 'flight'), ...onTab(items, 'history')]
    expect(split).toHaveLength(items.length)
  })

  it('counts both tabs off the same mapping, so a new status cannot be missed', () => {
    const items = [
      fromRun(run({ id: 'r-run', status: 'running' })),
      fromSession(session({ id: 'yours', updatedAt: Date.now() })),
      fromRun(run({ id: 'r-done', status: 'completed' })),
    ]
    expect(tabCounts(items)).toEqual({ flight: 2, history: 1 })
  })

  it('keeps a blocked session out of history, however long it has been stuck', () => {
    const stuck = fromSession(session({ id: 'x', activity: 'awaiting-permission', updatedAt: 1 }))
    expect(onTab([stuck], 'history')).toEqual([])
    expect(onTab([stuck], 'flight')).toEqual([stuck])
  })
})
