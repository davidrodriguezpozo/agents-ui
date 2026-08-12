import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeStatus } from '../server/utils/worktrees'

/**
 * The polled sessions list used to read every worktree on every poll, which is
 * four `git` invocations per session however little had changed. At forty-five
 * sessions that is 180 subprocesses every four seconds, and the cost was not
 * paid by the list — it was paid by whatever else you were trying to do, which
 * queued behind it.
 *
 * These are about spawn counts rather than milliseconds, because milliseconds on
 * a machine that is also running eight agents measure the machine.
 */

const reads: string[] = []
const fingerprints: string[] = []

/** What each worktree's fingerprint comes back as, so a change can be staged. */
const contents = new Map<string, string>()

vi.mock('../server/utils/worktrees', () => ({
  worktreeStatus: vi.fn(async (worktreePath: string): Promise<WorktreeStatus> => {
    reads.push(worktreePath)
    return {
      path: worktreePath,
      exists: true,
      branch: 'some-branch',
      changedFiles: 1,
      dirty: false,
      ahead: 1,
      behind: 0,
    }
  }),
}))

vi.mock('../server/utils/checks', () => ({
  worktreeFingerprint: vi.fn(async (worktreePath: string) => {
    fingerprints.push(worktreePath)
    return contents.get(worktreePath) ?? 'sha-of-nothing'
  }),
}))

const { worktreeStates, forgetWorktreeStates } = await import('../server/utils/worktreeStates')

function sessions(count: number, live = false) {
  return Array.from({ length: count }, (_, i) => ({
    worktreePath: `/repo/.worktrees/s${i}`,
    baseRef: 'abc123',
    baseBranch: 'main',
    version: 1000,
    live,
  }))
}

describe('worktreeStates', () => {
  beforeEach(() => {
    reads.length = 0
    fingerprints.length = 0
    contents.clear()
    forgetWorktreeStates()
  })

  it('reads every worktree it has never seen, because there is nothing to show instead', async () => {
    const states = await worktreeStates(sessions(45), { now: () => 0 })

    expect(reads).toHaveLength(45)
    expect(states).toHaveLength(45)
    expect(states[7]!.status.path).toBe('/repo/.worktrees/s7')
  })

  it('reads nothing on a second poll moments later', async () => {
    const list = sessions(45)
    await worktreeStates(list, { now: () => 0 })
    reads.length = 0

    await worktreeStates(list, { now: () => 4_000 })

    expect(reads).toEqual([])
  })

  it('keeps a session with a turn in flight fresh, poll after poll', async () => {
    const list = sessions(1, true)
    await worktreeStates(list, { now: () => 0 })
    reads.length = 0

    await worktreeStates(list, { now: () => 2_500 })

    expect(reads).toEqual(['/repo/.worktrees/s0'])
  })

  it('re-reads only a few idle worktrees per poll, so no single poll pays for all of them', async () => {
    const list = sessions(45)
    await worktreeStates(list, { now: () => 0 })
    reads.length = 0

    // Well past the window in which an idle answer stands: all forty-five are
    // now stale, and a poll that re-read all of them is the original problem.
    await worktreeStates(list, { now: () => 60_000, budget: 8 })

    expect(reads).toHaveLength(8)
  })

  it('works round the list rather than re-reading the same few, oldest first', async () => {
    const list = sessions(6)

    // Seed them at staggered times, so "oldest" is a real ordering.
    for (const [index, session] of list.entries()) {
      await worktreeStates([session], { now: () => index * 1_000 })
    }
    reads.length = 0

    await worktreeStates(list, { now: () => 100_000, budget: 2 })
    expect(reads).toEqual(['/repo/.worktrees/s0', '/repo/.worktrees/s1'])

    await worktreeStates(list, { now: () => 100_001, budget: 2 })
    expect(reads).toEqual([
      '/repo/.worktrees/s0', '/repo/.worktrees/s1',
      '/repo/.worktrees/s2', '/repo/.worktrees/s3',
    ])
  })

  it('re-reads immediately when the session record has changed, whatever the window says', async () => {
    const list = sessions(3)
    await worktreeStates(list, { now: () => 0 })
    reads.length = 0

    // What a merge, a finished turn or a check leaves behind.
    const touched = list.map((s, i) => (i === 1 ? { ...s, version: 2000 } : s))
    await worktreeStates(touched, { now: () => 1_000 })

    expect(reads).toEqual(['/repo/.worktrees/s1'])
  })

  it('re-reads when the base it is measured against moves', async () => {
    const list = sessions(1)
    await worktreeStates(list, { now: () => 0 })
    reads.length = 0

    await worktreeStates([{ ...list[0]!, baseBranch: 'develop' }], { now: () => 1_000 })

    expect(reads).toEqual(['/repo/.worktrees/s0'])
  })

  it('reads a cold worktree once when two requests want it at the same moment', async () => {
    const list = sessions(4)

    await Promise.all([
      worktreeStates(list, { now: () => 0 }),
      worktreeStates(list, { now: () => 0 }),
    ])

    expect(reads).toHaveLength(4)
  })

  it('answers in the order asked, not the order read', async () => {
    const list = sessions(5)
    const states = await worktreeStates(list, { now: () => 0 })

    expect(states.map(s => s.status.path)).toEqual(list.map(s => s.worktreePath))
  })

  /**
   * The check fingerprint is three more `git` invocations, one of them a full
   * `git diff HEAD`. It goes out of date under exactly the same conditions as
   * the rest of a worktree's state, so it is taken in the same pass and stands
   * for the same length of time.
   */
  describe('the check fingerprint', () => {
    it('is not taken unless it is asked for', async () => {
      const states = await worktreeStates(sessions(3), { now: () => 0 })

      expect(fingerprints).toEqual([])
      expect(states[0]!.fingerprint).toBeNull()
    })

    it('is taken alongside the status, not in a second round of spawns', async () => {
      const list = sessions(2).map(s => ({ ...s, fingerprint: true }))
      const states = await worktreeStates(list, { now: () => 0 })

      expect(fingerprints).toHaveLength(2)
      expect(states[0]!.fingerprint).toBe('sha-of-nothing')
    })

    it('is not retaken on the next poll', async () => {
      const list = sessions(2).map(s => ({ ...s, fingerprint: true }))
      await worktreeStates(list, { now: () => 0 })
      fingerprints.length = 0

      await worktreeStates(list, { now: () => 4_000 })

      expect(fingerprints).toEqual([])
    })

    it('is taken when a session that did not want one now does', async () => {
      // A check has just run, so there is now a verdict that could go stale.
      const list = sessions(1)
      await worktreeStates(list, { now: () => 0 })
      fingerprints.length = 0

      const states = await worktreeStates(
        list.map(s => ({ ...s, fingerprint: true })),
        { now: () => 1_000 },
      )

      expect(fingerprints).toEqual(['/repo/.worktrees/s0'])
      expect(states[0]!.fingerprint).toBe('sha-of-nothing')
    })

    it('follows the files: a re-read reports what the worktree says now', async () => {
      const list = sessions(1, true).map(s => ({ ...s, fingerprint: true }))
      await worktreeStates(list, { now: () => 0 })

      contents.set('/repo/.worktrees/s0', 'sha-of-an-edit')
      const states = await worktreeStates(list, { now: () => 5_000 })

      expect(states[0]!.fingerprint).toBe('sha-of-an-edit')
    })
  })
})
