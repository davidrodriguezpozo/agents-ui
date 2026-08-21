import { describe, it, expect } from 'vitest'
import {
  buildWorkList, railCount, railGroups, RAIL_GROUPS, TAB_STATUSES,
} from '~/utils/workList'
import type { Session } from '~/composables/useSessions'
import type { RunSummary } from '~/composables/useRuns'

/**
 * The rail's grouping.
 *
 * The one thing worth guarding here is coverage: the rail is the only place
 * in-flight work is listed now, so a status it has no group for is a session that
 * silently never appears anywhere. That is a worse failure than a mis-sorted
 * heading, and it is the kind that ships — nothing on screen looks broken.
 */

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

/** Work sitting in a workspace nobody has merged: "your turn". */
const changed = { path: '/w', exists: true, branch: 'b', changedFiles: 4, dirty: false, ahead: 1, behind: 0 }

const titles = (groups: ReturnType<typeof railGroups>) => groups.map(g => g.title)

describe('the rail covers every in-flight status', () => {
  it('has a group for each one, so nothing can fall through it', () => {
    expect([...RAIL_GROUPS.map(g => g.status)].sort()).toEqual([...TAB_STATUSES.flight].sort())
  })

  it('names each status once', () => {
    const statuses = RAIL_GROUPS.map(g => g.status)
    expect(new Set(statuses).size).toBe(statuses.length)
  })

  it('offers nothing the History view owns — a settled row is not in flight', () => {
    const settled = RAIL_GROUPS.filter(g => TAB_STATUSES.history.includes(g.status))
    expect(settled).toEqual([])
  })
})

describe('grouping', () => {
  it('reads urgency first, so what is asking for a decision is at the top', () => {
    // Not the order the statuses are declared in, and not recency: a session
    // blocked since 02:00 must not sit under whatever started most recently.
    const items = buildWorkList({
      sessions: [
        session({ id: 'w', title: 'working', activity: 'working' }),
        session({ id: 'y', title: 'yours', worktree: changed }),
        session({ id: 'n', title: 'needs you', activity: 'awaiting-permission' }),
      ],
      runs: [],
    })

    expect(titles(railGroups(items))).toEqual(['Needs you', 'Working', 'Your turn'])
  })

  it('drops a group with nothing in it rather than printing an empty heading', () => {
    const items = buildWorkList({
      sessions: [session({ activity: 'working' })],
      runs: [],
    })

    expect(titles(railGroups(items))).toEqual(['Working'])
  })

  it('leaves out what is finished with, which is the History view\'s half', () => {
    // The factory dates a session at 1970 and gives it no changes, so it has
    // aged out — settled, and therefore not the rail's.
    const items = buildWorkList({ sessions: [session()], runs: [] })

    expect(railGroups(items)).toEqual([])
    expect(railCount(items)).toBe(0)
  })

  it('puts a session and a ritual run in the same group when they are in the same state', () => {
    // The rail is work in flight, not sessions in flight. A ritual mid-run is
    // something you might open, and filing it elsewhere would mean two lists.
    const items = buildWorkList({
      sessions: [session({ id: 's', title: 'a session', activity: 'working' })],
      runs: [run({ id: 'r', title: 'a ritual', status: 'running', source: 'ritual' })],
    })

    const groups = railGroups(items)
    expect(titles(groups)).toEqual(['Working'])
    expect(groups[0]!.items.map(i => i.origin).sort()).toEqual(['ritual', 'session'])
  })

  it('keeps the order it was given, because the list arrives already sorted', () => {
    const items = buildWorkList({
      sessions: [
        session({ id: 'old', title: 'older', activity: 'working', updatedAt: 100 }),
        session({ id: 'new', title: 'newer', activity: 'working', updatedAt: 900 }),
      ],
      runs: [],
    })

    // `buildWorkList` sorts by urgency then recency; grouping must not re-sort.
    expect(railGroups(items)[0]!.items.map(i => i.title)).toEqual(['newer', 'older'])
  })
})

describe('the count beside the heading', () => {
  it('counts what is in flight and nothing else', () => {
    const items = buildWorkList({
      sessions: [
        session({ id: 'a', activity: 'working' }),
        session({ id: 'b', activity: 'awaiting-permission' }),
        // Settled: aged out with nothing to show for it.
        session({ id: 'c' }),
      ],
      runs: [run({ id: 'r', status: 'completed' })],
    })

    expect(railCount(items)).toBe(2)
  })

  it('agrees with the groups it is printed above', () => {
    const items = buildWorkList({
      sessions: [
        session({ id: 'a', activity: 'working' }),
        session({ id: 'b', activity: 'awaiting-permission' }),
        session({ id: 'c', worktree: changed }),
      ],
      runs: [run({ id: 'r', status: 'running' })],
    })

    const total = railGroups(items).reduce((n, group) => n + group.items.length, 0)
    expect(total).toBe(railCount(items))
  })
})
