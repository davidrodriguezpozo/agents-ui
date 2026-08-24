import { describe, it, expect } from 'vitest'
import {
  buildWorkList, railCount, railGroups, RAIL_GROUPS, TAB_STATUSES,
} from '~/utils/workList'
import { closableFromRail, closeIntent } from '~/utils/sessionClose'
import type { Session } from '~/composables/useSessions'
import type { RunSummary } from '~/composables/useRuns'

/**
 * The rail: its grouping, and the one control it carries.
 *
 * Two failures worth guarding, both of the kind that ships because nothing on
 * screen looks broken.
 *
 * **Coverage.** The rail is the only place in-flight work is listed, so a status
 * it has no group for is a session that silently never appears anywhere — worse
 * than a mis-sorted heading.
 *
 * **What Close destroys.** `deleteBranch` on the server runs `git branch -D`, so
 * offering Close on a session whose commits are not in the base would throw them
 * away from a sidebar. `closeIntent` lives in `~/utils/sessionClose` and is
 * tested here, beside the grouping it depends on and the fixture they share.
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

  /**
   * The group this whole status exists for. A merged session used to leave the
   * rail the instant it landed, which is right about the commits and wrong about
   * the worktree, the branch and the checkout still sitting on disk — the one
   * thing left to do with it is close it, and History is for reading.
   */
  it('keeps merged sessions on the rail, under Done, below your turn', () => {
    const items = buildWorkList({
      sessions: [
        session({ id: 'in', title: 'merged', landed: true, worktree: changed, updatedAt: 9_000 }),
        session({ id: 'y', title: 'yours', worktree: changed, updatedAt: 1_000 }),
      ],
      runs: [],
    })

    const groups = railGroups(items)
    expect(titles(groups)).toEqual(['Your turn', 'Done'])
    expect(groups[1]!.items.map(i => i.title)).toEqual(['merged'])
    expect(railCount(items)).toBe(2)
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

/**
 * Closing a session from the rail.
 *
 * The whole risk here is one line in the server: `deleteBranch` runs
 * `git branch -D`, a force delete. That is correct for work that has landed and
 * is destruction for work that has not — so the only failure worth guarding
 * against is a row offering a close that quietly throws away commits.
 */
describe('which rows can be closed from the rail', () => {
  it('offers it on a merged session, which is the only thing left to do with one', () => {
    const [item] = buildWorkList({ sessions: [session({ landed: true })], runs: [] })
    expect(closableFromRail(item!)).toBe(true)
  })

  /** The point of the change: this is where sessions nobody wants collect. */
  it('offers it on "Your turn", where the tidying-up piles up', () => {
    const [item] = buildWorkList({ sessions: [session({ worktree: changed })], runs: [] })
    expect(item!.status).toBe('yours')
    expect(closableFromRail(item!)).toBe(true)
  })

  it('does not offer it while a turn is still going', () => {
    const [item] = buildWorkList({ sessions: [session({ activity: 'working' })], runs: [] })
    expect(item!.status).toBe('running')
    expect(closableFromRail(item!)).toBe(false)
  })

  it('does not offer it on a session waiting for a permission answer', () => {
    const [item] = buildWorkList({ sessions: [session({ activity: 'awaiting-permission' })], runs: [] })
    expect(item!.status).toBe('needs-you')
    expect(closableFromRail(item!)).toBe(false)
  })

  /** A run has no workspace to remove, so there is nothing for this to mean. */
  it('never offers it on a run', () => {
    const [item] = buildWorkList({ sessions: [], runs: [run({ status: 'completed' })] })
    expect(closableFromRail(item!)).toBe(false)
  })
})

describe('what closing a row will actually do', () => {
  it('deletes the branch of a merged session, because the commits are in the base', () => {
    const merged = session({ landed: true })
    const [item] = buildWorkList({ sessions: [merged], runs: [] })
    const intent = closeIntent(item!, merged)

    expect(intent.keepBranch).toBe(false)
    expect(intent.hint).toContain('deletes the branch')
    expect(intent.hint).toContain('The commits are in main')
  })

  /**
   * The one that matters. `git branch -D` on this would destroy the commit, from
   * a sidebar, behind a button labelled "Close".
   */
  it('keeps the branch when there are commits the base does not have', () => {
    const unlanded = session({ worktree: changed })
    const [item] = buildWorkList({ sessions: [unlanded], runs: [] })
    const intent = closeIntent(item!, unlanded)

    expect(intent.keepBranch).toBe(true)
    expect(intent.hint).toContain('keeps the branch')
    expect(intent.hint).toContain('Nothing committed is lost')
  })

  it('counts those commits in words a person can check against git', () => {
    const one = session({ worktree: { ...changed, ahead: 1 } })
    const three = session({ worktree: { ...changed, ahead: 3 } })

    expect(closeIntent(buildWorkList({ sessions: [one], runs: [] })[0]!, one).hint)
      .toContain('1 commit that is not in main')
    expect(closeIntent(buildWorkList({ sessions: [three], runs: [] })[0]!, three).hint)
      .toContain('3 commits that are not in main')
  })

  /**
   * A session that answered a question and produced nothing. The full tidy-up is
   * right here — there is no work to keep a branch for.
   */
  it('deletes the branch of a session that committed nothing', () => {
    const empty = session({ worktree: { ...changed, changedFiles: 2, ahead: 0 } })
    const [item] = buildWorkList({ sessions: [empty], runs: [] })
    const intent = closeIntent(item!, empty)

    expect(item!.status).toBe('yours')
    expect(intent.keepBranch).toBe(false)
    expect(intent.hint).toContain('Nothing has been committed here')
  })

  /** Never says "deletes the branch" about a branch it is about to keep. */
  it('never promises to delete a branch it keeps, or keep one it deletes', () => {
    for (const s of [
      session({ landed: true }),
      session({ worktree: changed }),
      session({ worktree: { ...changed, ahead: 0 } }),
    ]) {
      const [item] = buildWorkList({ sessions: [s], runs: [] })
      const intent = closeIntent(item!, s)
      expect(intent.hint.includes('deletes the branch')).toBe(!intent.keepBranch)
      expect(intent.hint.includes('keeps the branch')).toBe(intent.keepBranch)
    }
  })
})
