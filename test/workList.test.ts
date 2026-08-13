import { describe, it, expect } from 'vitest'
import { buildWorkList, fromRun, fromSession, statusCounts, type WorkItem } from '~/utils/workList'
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
