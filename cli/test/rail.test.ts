import { describe, expect, it } from 'vitest'
import { buildRail, onFilter, railCounts, unreadOf, type RailInput } from '../rail'
import type { Pull, Schedule, Session } from '../types'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'Fix the flaky test',
    repoDir: '/repo',
    worktreePath: '/repo/.worktrees/s1',
    branch: 'feat/flaky',
    baseBranch: 'main',
    status: 'idle',
    runIds: [],
    createdAt: 1,
    updatedAt: 5_000,
    worktree: {
      path: '/repo/.worktrees/s1',
      exists: true,
      branch: 'feat/flaky',
      changedFiles: 2,
      dirty: true,
      ahead: 1,
      behind: 0,
    },
    activity: 'idle',
    pendingPermissions: 0,
    lastRunId: 'r1',
    turnCount: 2,
    inCurrentProject: true,
    ...over,
  }
}

function pull(over: Partial<Pull> = {}): Pull {
  return {
    number: 418,
    title: 'Cache the pull request lookup',
    url: 'https://github.com/x/y/pull/418',
    author: 'marta',
    mine: false,
    draft: false,
    headBranch: 'feat/pr-cache',
    baseBranch: 'main',
    createdAt: 1_000,
    updatedAt: 9_000,
    additions: 80,
    deletions: 12,
    changedFiles: 12,
    checks: 'passing',
    verdict: { state: 'review', label: 'waiting on you', detail: '', onYou: true },
    intent: 'review',
    ...over,
  }
}

function schedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 'r-1',
    title: 'Morning triage',
    input: 'triage',
    enabled: true,
    origin: 'user',
    permission: 'edits',
    description: 'every day at 08:00',
    createdAt: 1,
    lastRunAt: 4_000,
    ...over,
  }
}

function input(over: Partial<RailInput> = {}): RailInput {
  return {
    sessions: [],
    runs: [],
    pulls: null,
    schedules: [],
    histories: {},
    inbox: [],
    projects: [],
    activeProject: '/repo',
    scope: '/repo',
    home: '/home',
    ...over,
  }
}

describe('buildRail', () => {
  it('puts what wants you above what does not', () => {
    const items = buildRail(input({
      sessions: [
        session({ id: 'quiet', title: 'Landed thing', landed: true, updatedAt: 9_000 }),
        session({ id: 'blocked', title: 'Blocked thing', activity: 'awaiting-permission', pendingPermissions: 1, updatedAt: 1_000 }),
      ],
      pulls: { reviewing: [pull()], mine: [] },
      schedules: [schedule()],
      histories: { 'r-1': { runs: [], failingStreak: 4 } },
    }))

    expect(items[0]!.urgency).toBe('needs-you')
    // Two things need you here — a blocked session and a review — and both come
    // before the ritual that has been failing, which comes before the quiet one.
    expect(items.map(item => item.urgency)).toEqual([...items.map(item => item.urgency)].sort(
      (a, b) => ['needs-you', 'broken', 'working', 'ready', 'waiting', 'quiet'].indexOf(a)
        - ['needs-you', 'broken', 'working', 'ready', 'waiting', 'quiet'].indexOf(b),
    ))
    expect(items.find(item => item.kind === 'ritual')!.urgency).toBe('broken')
  })

  it('leaves out other projects, which the server has already decided', () => {
    const items = buildRail(input({
      sessions: [session(), session({ id: 'elsewhere', title: 'Another repo', inCurrentProject: false })],
    }))
    expect(items.map(item => item.title)).not.toContain('Another repo')
  })

  it('sorts by recency inside a band, and is stable between polls', () => {
    const built = () => buildRail(input({
      sessions: [
        session({ id: 'a', title: 'Older', updatedAt: 1_000, filedAt: undefined }),
        session({ id: 'b', title: 'Newer', updatedAt: 8_000 }),
      ],
    })).map(item => item.key)

    expect(built()).toEqual(built())
  })

  it('says what a row is for, in the words its own kind uses', () => {
    const [item] = buildRail(input({ pulls: { reviewing: [pull()], mine: [] } }))
    expect(item!.title).toContain('#418')
    expect(item!.status).toBe('waiting on you')
    expect(item!.detail).toContain('12 files')
    expect(item!.browserPath).toContain('github.com')
  })

  it('files a review somebody asked for under Needs you, whatever CI is doing', () => {
    /*
     * The verdict is the server's — see `verdictFor`, which now says a review
     * request is on you even while the build runs. This is the rail's half of
     * it: the row that produced this went under `Quiet`, while the page had the
     * same pull request under "Waiting for your review".
     */
    const [item] = buildRail(input({
      pulls: {
        reviewing: [pull({
          checks: 'pending',
          verdict: { state: 'checks-running', label: 'Checks running', detail: '', onYou: true },
        })],
        mine: [],
      },
    }))

    expect(item!.urgency).toBe('needs-you')
  })

  it('counts a project as a row, so switching is not a separate screen', () => {
    const items = buildRail(input({
      projects: [{ path: '/repo', exists: true, isRepo: true, branch: 'main', hasClaudeDir: true, sessionCount: 3 }],
    }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'project', status: 'Here' })
  })

  it('marks a project this window is looking at but the app is not', () => {
    const items = buildRail(input({
      activeProject: '/other',
      projects: [{ path: '/repo', exists: true, isRepo: true, branch: 'main', hasClaudeDir: false, sessionCount: 0 }],
    }))
    expect(items[0]!.status).toBe('Here only')
  })
})

describe('onFilter', () => {
  const items = buildRail(input({
    sessions: [session({ activity: 'awaiting-permission', pendingPermissions: 1 })],
    pulls: { reviewing: [], mine: [pull({ mine: true, verdict: { state: 'ready', label: 'ready to merge', detail: '', onYou: false } })] },
    schedules: [schedule()],
    projects: [{ path: '/repo', exists: true, isRepo: true, branch: 'main', hasClaudeDir: true, sessionCount: 1 }],
  }))

  it('shows one kind at a time', () => {
    expect(onFilter(items, 'pull').every(item => item.kind === 'pull')).toBe(true)
    expect(onFilter(items, 'ritual')).toHaveLength(1)
    expect(onFilter(items, 'all')).toEqual(items)
  })

  it('keeps runs with the sessions, which are the same work from the other end', () => {
    expect(onFilter(items, 'session').every(item => item.kind === 'session' || item.kind === 'run')).toBe(true)
  })

  it('takes needs-you to mean broken as well, because both stop you', () => {
    expect(onFilter(items, 'needs-you').every(
      item => item.urgency === 'needs-you' || item.urgency === 'broken',
    )).toBe(true)
  })
})

describe('railCounts', () => {
  it('counts each kind, and everything that wants you', () => {
    const items = buildRail(input({
      sessions: [session({ activity: 'awaiting-permission', pendingPermissions: 1 })],
      pulls: { reviewing: [pull()], mine: [] },
    }))
    const counts = railCounts(items)
    expect(counts.all).toBe(2)
    expect(counts['needs-you']).toBe(2)
    expect(counts.pull).toBe(1)
    expect(counts.session).toBe(1)
  })
})

describe('unreadOf', () => {
  it('is what has moved since you looked at it', () => {
    const items = buildRail(input({ sessions: [session({ updatedAt: 5_000 })] }))
    const key = items[0]!.key

    expect(unreadOf(items, {})).toHaveLength(1)
    expect(unreadOf(items, { [key]: 5_000 })).toHaveLength(0)
    expect(unreadOf(items, { [key]: 4_000 })).toHaveLength(1)
  })

  it('says nothing about the kinds that cannot talk', () => {
    const items = buildRail(input({
      projects: [{ path: '/repo', exists: true, isRepo: true, branch: 'main', hasClaudeDir: true, sessionCount: 0 }],
    }))
    expect(unreadOf(items, {})).toHaveLength(0)
  })
})
