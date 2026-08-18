import { describe, it, expect } from 'vitest'
import {
  buildWorkList, fromRun, fromSession, onTab, removableRuns, statusCounts, tabOf,
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
    // status enum would have flattened: both are "done".
    const ready = fromSession(session({ worktree: changed }))
    const nothing = fromSession(session())

    expect([ready.status, ready.outcome]).toEqual(['done', 'Ready to land'])
    expect([nothing.status, nothing.outcome]).toEqual(['done', 'Nothing came of it'])
  })

  it('says merged once it is in the base branch', () => {
    expect(fromSession(session({ worktree: changed, landed: true })).outcome).toBe('Merged')
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
    expect(buildWorkList(input, { status: 'done' }).map(i => i.title).sort())
      .toEqual(['faceted search', 'morning brief'])
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
    expect(buildWorkList(input, { status: 'done', origin: 'session' }).map(i => i.title))
      .toEqual(['faceted search'])
  })
})

describe('statusCounts', () => {
  it('counts every status, including the empty ones', () => {
    const items = buildWorkList({
      sessions: [session({ activity: 'awaiting-permission' })],
      runs: [run({ status: 'running' })],
    })
    expect(statusCounts(items)).toEqual({ running: 1, 'needs-you': 1, done: 0, failed: 0 })
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
    ]
    const split = [...onTab(items, 'flight'), ...onTab(items, 'history')]
    expect(split).toHaveLength(items.length)
  })

  it('keeps a blocked session out of history, however long it has been stuck', () => {
    const stuck = fromSession(session({ id: 'x', activity: 'awaiting-permission', updatedAt: 1 }))
    expect(onTab([stuck], 'history')).toEqual([])
    expect(onTab([stuck], 'flight')).toEqual([stuck])
  })
})
