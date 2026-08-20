import { describe, expect, it } from 'vitest'
import type { Api } from '../api'
import { parseArgs } from '../args'
import { runCommand } from '../commands'
import type { Session } from '../types'

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
    updatedAt: 2,
    worktree: {
      path: '/repo/.worktrees/s1',
      exists: true,
      branch: 'feat/flaky',
      changedFiles: 4,
      dirty: true,
      ahead: 1,
      behind: 0,
    },
    activity: 'awaiting-permission',
    pendingPermissions: 1,
    lastRunId: 'r1',
    turnCount: 3,
    inCurrentProject: true,
    ...over,
  }
}

/**
 * Only the endpoints a given command reaches; the rest would be a lie.
 *
 * The client is always there, because every command is scoped before it asks
 * anything — that is the header that decides which project it is talking about.
 */
function api(over: Partial<Api>): Api {
  return {
    client: { projectDirValue: null },
    projects: async () => ({ projects: [], activePath: null, home: '/home' }),
    ...over,
  } as Api
}

function printer() {
  const out: string[] = []
  const err: string[] = []
  return { out, err, print: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } }
}

describe('work', () => {
  it('exits 2 when something is waiting on you, so a shell can branch on it', async () => {
    const print = printer()
    const code = await runCommand(
      api({
        sessions: async () => [session()],
        runs: async () => [],
        attention: async () => ({ blocked: 1, working: 0, failingRituals: 0, needsYou: 1, items: [] }),
      }),
      parseArgs(['work'], {}),
      print.print,
    )

    expect(code).toBe(2)
    expect(print.out.join('\n')).toContain('Fix the flaky test')
    expect(print.out.join('\n')).toContain('1 need you')
  })

  it('exits 0 with nothing waiting', async () => {
    const print = printer()
    const code = await runCommand(
      api({
        sessions: async () => [],
        runs: async () => [],
        attention: async () => ({ blocked: 0, working: 0, failingRituals: 0, needsYou: 0, items: [] }),
      }),
      parseArgs(['work'], {}),
      print.print,
    )

    expect(code).toBe(0)
    expect(print.out.join('\n')).toContain('Nothing in flight here.')
  })

  it('leaves out this project nothing that belongs to another one', async () => {
    const print = printer()
    await runCommand(
      api({
        sessions: async () => [session({ id: 'other', title: 'Somebody else', inCurrentProject: false })],
        runs: async () => [],
        attention: async () => ({ blocked: 0, working: 0, failingRituals: 0, needsYou: 0, items: [] }),
      }),
      parseArgs(['work'], {}),
      print.print,
    )

    expect(print.out.join('\n')).not.toContain('Somebody else')
  })

  it('says nothing at all when asked to be quiet', async () => {
    const print = printer()
    const code = await runCommand(
      api({
        sessions: async () => [session()],
        runs: async () => [],
        attention: async () => ({ blocked: 1, working: 0, failingRituals: 0, needsYou: 1, items: [] }),
      }),
      parseArgs(['work', '--quiet'], {}),
      print.print,
    )

    expect(code).toBe(2)
    expect(print.out).toEqual([])
  })

  it('prints something a pipe can read', async () => {
    const print = printer()
    await runCommand(
      api({
        sessions: async () => [session()],
        runs: async () => [],
        attention: async () => ({ blocked: 1, working: 0, failingRituals: 0, needsYou: 1, items: [] }),
      }),
      parseArgs(['work', '--json'], {}),
      print.print,
    )

    const parsed = JSON.parse(print.out.join('\n'))
    expect(parsed.attention.needsYou).toBe(1)
    expect(parsed.items).toHaveLength(1)
  })
})

describe('daily', () => {
  it('exits 2 for a ritual that has failed twice running', async () => {
    const print = printer()
    const code = await runCommand(
      api({
        schedules: async () => [{
          id: 'r1',
          title: 'Flaky test hunt',
          input: 'hunt',
          enabled: true,
          origin: 'user' as const,
          permission: 'edits' as const,
          description: 'every day at 22:00',
          createdAt: 1,
        }],
        scheduleHistory: async () => ({ r1: { runs: [], failingStreak: 3 } }),
      }),
      parseArgs(['daily'], {}),
      print.print,
    )

    expect(code).toBe(2)
    expect(print.out.join('\n')).toContain('3 failed')
  })
})

describe('new', () => {
  it('refuses to guess a project when there is none', async () => {
    const print = printer()
    const code = await runCommand(
      api({}),
      parseArgs(['new', 'do', 'the', 'thing'], {}),
      print.print,
    )

    expect(code).toBe(1)
    expect(print.err.join('\n')).toContain('--project')
  })

  it('starts one in the project it was given, and says how to watch it', async () => {
    const print = printer()
    let asked: unknown
    const code = await runCommand(
      api({
        startSession: async (body) => {
          asked = body
          return { id: 's9' }
        },
      }),
      parseArgs(['new', 'fix', 'it', '--project', '/repo'], {}),
      print.print,
    )

    expect(code).toBe(0)
    expect(asked).toEqual({ prompt: 'fix it', repoDir: '/repo' })
    expect(print.out.join('\n')).toContain('agents-studio tui s9')
  })
})
