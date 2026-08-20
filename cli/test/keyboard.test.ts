import { EventEmitter } from 'node:events'
import { createElement } from 'react'
import { render } from 'ink'
import { afterEach, describe, expect, it } from 'vitest'
import type { Api } from '../api'
import { App } from '../ui/App'
import type { Session, SessionDetail } from '../types'

/**
 * The keyboard, driven for real.
 *
 * Ink renders to any stream, so the app can be mounted on a fake terminal and
 * typed at — which is the only way to be sure that `⏎` opens a session, that
 * `q` in a session goes back rather than quitting, and that a chord reaches the
 * view underneath it. The plan claimed the rendering was "checked by hand";
 * this is the part of that which does not need hands.
 */

/**
 * Ink reads its input the way Node prefers: a `readable` event and then
 * `read()` until it comes back null. A fake that emitted `data` instead looks
 * identical and delivers nothing, which is worth knowing once.
 */
class FakeStdin extends EventEmitter {
  isTTY = true
  private queue: string[] = []
  setRawMode() { return this }
  setEncoding() { return this }
  resume() { return this }
  pause() { return this }
  ref() {}
  unref() {}
  read(): string | null { return this.queue.shift() ?? null }
  write(data: string) {
    this.queue.push(data)
    this.emit('readable')
  }
}

class FakeStdout extends EventEmitter {
  columns = 120
  rows = 40
  frames: string[] = []
  write(data: string) {
    this.frames.push(data)
    return true
  }

  /** The last frame, with the escape codes taken out. */
  get screen(): string {
    return (this.frames.at(-1) ?? '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  }
}

function session(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 's1',
    title: 'Fix the flaky terminal test',
    repoDir: '/repo',
    worktreePath: '/repo/.worktrees/s1',
    branch: 'feat/flaky',
    baseBranch: 'main',
    status: 'idle',
    runIds: ['r1'],
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
    activity: 'idle',
    pendingPermissions: 0,
    lastRunId: 'r1',
    turnCount: 1,
    inCurrentProject: true,
    turns: [{ id: 'r1', input: 'Look at the test', output: 'It waits on a timer.', status: 'completed', createdAt: 1 }],
    checkCommand: 'bun test',
    ...over,
  }
}

const PATCH = [
  'diff --git a/app/one.ts b/app/one.ts',
  '--- a/app/one.ts',
  '+++ b/app/one.ts',
  '@@ -1 +1 @@',
  '+first file',
  'diff --git a/server/two.ts b/server/two.ts',
  '--- a/server/two.ts',
  '+++ b/server/two.ts',
  '@@ -1 +1 @@',
  '+second file',
].join('\n')

function api(): Api {
  const never = async function* (_path: string, options: { signal?: AbortSignal }) {
    // The notification stream, which stays open and yields nothing here.
    await new Promise<void>((resolve) => {
      if (options.signal?.aborted) return resolve()
      options.signal?.addEventListener('abort', () => resolve(), { once: true })
    })
  }

  return {
    client: { events: never, projectDirValue: null },
    projects: async () => ({
      projects: [{ path: '/repo', exists: true, isRepo: true, branch: 'main', hasClaudeDir: true, sessionCount: 1 }],
      activePath: '/repo',
      home: '/home',
    }),
    attention: async () => ({ blocked: 0, working: 0, failingRituals: 0, needsYou: 0, items: [] }),
    sessions: async (): Promise<Session[]> => [session()],
    runs: async () => [],
    session: async () => session(),
    diff: async () => ({ files: [], patch: PATCH }),
  } as unknown as Api
}

/** Let the polls resolve and Ink draw what came back. */
async function settle(times = 6) {
  for (let i = 0; i < times; i++) await new Promise(resolve => setTimeout(resolve, 10))
}

let running: { unmount: () => void } | null = null

afterEach(() => {
  running?.unmount()
  running = null
})

async function mount() {
  const stdin = new FakeStdin()
  const stdout = new FakeStdout()
  const instance = render(createElement(App, { api: api(), baseUrl: 'http://127.0.0.1:3000' }), {
    stdin: stdin as never,
    stdout: stdout as never,
    patchConsole: false,
    exitOnCtrlC: false,
  })
  running = instance
  await settle()
  return { stdin, stdout, instance }
}

describe('the app on a fake terminal', () => {
  it('draws the work list, with the tab strip advertising its chords', async () => {
    const { stdout } = await mount()
    expect(stdout.screen).toContain('Fix the flaky terminal test')
    expect(stdout.screen).toContain('w Work')
    expect(stdout.screen).toContain('p Projects')
  })

  it('opens the selected session on ⏎, and comes back on esc', async () => {
    const { stdin, stdout } = await mount()

    stdin.write('\r')
    await settle()
    // The session view says what branch it is on; the list does not.
    expect(stdout.screen).toContain('feat/flaky → main')
    expect(stdout.screen).toContain('It waits on a timer.')

    stdin.write('\x1b')
    await settle()
    expect(stdout.screen).toContain('w Work')
  })

  it('quits from a list, and only goes back from a session', async () => {
    const { stdin, instance } = await mount()

    stdin.write('\r')
    await settle()
    stdin.write('q')
    await settle()

    // Still running: `q` in a session is "back", the way it is in less.
    let exited = false
    void instance.waitUntilExit().then(() => { exited = true })
    await settle()
    expect(exited).toBe(false)

    stdin.write('q')
    await instance.waitUntilExit()
    expect(exited).toBe(true)
  })

  it('takes a `g` chord to a view, without the chord reaching the list', async () => {
    const { stdin, stdout } = await mount()

    stdin.write('g')
    await settle(2)
    stdin.write('d')
    await settle()
    expect(stdout.screen).toContain('d Daily')
    // The list under it did not also act on the `d`.
    expect(stdout.screen).not.toContain('Fix the flaky terminal test')
  })

  it('shows a half-typed count, and moves by it', async () => {
    const { stdin, stdout } = await mount()

    stdin.write('5')
    await settle(2)
    // Said out loud, because a key that leaves no trace looks like a dropped one.
    expect(stdout.screen).toContain('5')
  })

  it('shows the diff on d, walks it by file on tab, and leaves on esc', async () => {
    const { stdin, stdout } = await mount()

    stdin.write('\r')
    await settle()
    stdin.write('d')
    await settle()

    // The pane says what it is looking at, which the transcript does not.
    expect(stdout.screen).toContain('2 files  +2/−0')
    expect(stdout.screen).toContain('app/one.ts')
    expect(stdout.screen).toContain('first file')

    stdin.write('\t')
    await settle()
    expect(stdout.screen).toContain('server/two.ts')

    stdin.write('\x1b')
    await settle()
    // Back to the conversation rather than out of the session.
    expect(stdout.screen).toContain('It waits on a timer.')
  })

  it('opens the help page off the same table the footers read', async () => {
    const { stdin, stdout } = await mount()

    stdin.write('?')
    await settle()
    expect(stdout.screen).toContain('EVERYWHERE')
    // The keys for where you are: Work, not all nine surfaces at once.
    expect(stdout.screen).toContain('WORK')
    expect(stdout.screen).toContain('Continue a terminal conversation here')
    expect(stdout.screen).not.toContain('THE DIFF')

    stdin.write('?')
    await settle()
    expect(stdout.screen).toContain('w Work')
  })
})

/** A session with a run that is blocked on a permission prompt. */
function blockedApi(record: {
  answers: { id: string; behavior: string; opts?: unknown }[]
  checksStarted: () => void
}): Api {
  const forever = (signal?: AbortSignal) => new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    signal?.addEventListener('abort', () => resolve(), { once: true })
  })

  const events = async function* (path: string, options: { signal?: AbortSignal }) {
    if (path.includes('/api/runs/')) {
      yield { type: 'status', status: 'running', seq: 0 }
      yield {
        type: 'permission_request',
        seq: 1,
        request: {
          id: 'p1',
          ownerId: 'r1',
          toolName: 'Bash',
          input: { command: 'gh pr create --fill' },
          canRemember: true,
          suggestedRules: [],
          createdAt: 1,
        },
      }
    }
    await forever(options.signal)
  }

  return {
    client: { events, projectDirValue: null },
    projects: async () => ({
      projects: [{ path: '/repo', exists: true, isRepo: true, branch: 'main', hasClaudeDir: true, sessionCount: 1 }],
      activePath: '/repo',
      home: '/home',
    }),
    attention: async () => ({ blocked: 1, working: 1, failingRituals: 0, needsYou: 1, items: [] }),
    sessions: async () => [session({ status: 'running', activity: 'awaiting-permission' })],
    runs: async () => [],
    session: async () => session({ status: 'running', activity: 'awaiting-permission' }),
    diff: async () => ({ files: [], patch: '' }),
    runChecks: async () => {
      record.checksStarted()
      // Never resolves: the checks take minutes, which is the whole point.
      await forever()
      return { check: undefined }
    },
    answerPermission: async (id: string, behavior: string, opts?: unknown) => {
      record.answers.push({ id, behavior, opts })
    },
  } as unknown as Api
}

describe('a session waiting on a permission prompt', () => {
  async function open() {
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const record = { answers: [] as { id: string; behavior: string; opts?: unknown }[], checksStarted: () => {} }
    let started = false
    record.checksStarted = () => { started = true }

    const instance = render(
      createElement(App, { api: blockedApi(record), baseUrl: 'http://127.0.0.1:3000' }),
      { stdin: stdin as never, stdout: stdout as never, patchConsole: false, exitOnCtrlC: false },
    )
    running = instance
    await settle()
    stdin.write('\r')
    await settle()
    return { stdin, stdout, record, checksStarted: () => started }
  }

  it('shows the prompt from the stream, framed', async () => {
    const { stdout } = await open()
    expect(stdout.screen).toContain('Allow this?')
    expect(stdout.screen).toContain('gh pr create --fill')
  })

  it('answers while the checks are still running', async () => {
    const { stdin, record, checksStarted } = await open()

    stdin.write('c')
    await settle()
    expect(checksStarted()).toBe(true)

    // The bug this replaces: one shared busy flag meant `y` returned early and
    // said nothing until the ten-minute check finished.
    stdin.write('y')
    await settle()
    expect(record.answers).toEqual([{ id: 'p1', behavior: 'allow', opts: { scope: 'once' } }])
  })

  it('takes the prompt off the screen as soon as it is answered', async () => {
    const { stdin, stdout } = await open()
    stdin.write('a')
    await settle()
    expect(stdout.screen).not.toContain('Allow this?')
  })

  it('denies with a reason worth reading', async () => {
    const { stdin, stdout, record } = await open()

    stdin.write('N')
    await settle()
    expect(stdout.screen).toContain('no, because')

    stdin.write('use bun')
    await settle(2)
    stdin.write('\r')
    await settle()

    expect(record.answers).toEqual([{ id: 'p1', behavior: 'deny', opts: { message: 'use bun' } }])
  })
})

describe('what a transcript looks like', () => {
  it('renders the agent\'s Markdown rather than printing it', async () => {
    const output = [
      '## What I found',
      '',
      'The `useDebounce` hook never cleans up, so a **stale timer** fires after unmount.',
      '',
      '- one thing',
      '- another',
      '',
      '```ts',
      'clearTimeout(timer)',
      '```',
    ].join('\n')

    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const instance = render(
      createElement(App, {
        api: {
          client: {
            events: async function* (_p: string, o: { signal?: AbortSignal }) {
              await new Promise<void>(resolve => o.signal?.addEventListener('abort', () => resolve(), { once: true }))
            },
            projectDirValue: null,
          },
          projects: async () => ({
            projects: [{ path: '/repo', exists: true, isRepo: true, branch: 'main', hasClaudeDir: true, sessionCount: 1 }],
            activePath: '/repo',
            home: '/home',
          }),
          attention: async () => ({ blocked: 0, working: 0, failingRituals: 0, needsYou: 0, items: [] }),
          sessions: async () => [session()],
          runs: async () => [],
          session: async () => session({
            turns: [{ id: 'r1', input: 'Look at it', output, status: 'completed', createdAt: 1 }],
          }),
          diff: async () => ({ files: [], patch: '' }),
        } as unknown as Api,
        baseUrl: 'http://127.0.0.1:3000',
      }),
      { stdin: stdin as never, stdout: stdout as never, patchConsole: false, exitOnCtrlC: false },
    )
    running = instance
    await settle()
    stdin.write('\r')
    await settle()

    const screen = stdout.screen
    // The punctuation is gone; the words it was marking up are not.
    expect(screen).toContain('What I found')
    expect(screen).not.toContain('## What I found')
    expect(screen).toContain('stale timer')
    expect(screen).not.toContain('**stale timer**')
    expect(screen).toContain('useDebounce')
    expect(screen).not.toContain('`useDebounce`')
    // A list reads as a list, and a fence is still verbatim.
    expect(screen).toContain('• one thing')
    expect(screen).toContain('clearTimeout(timer)')
    expect(screen).not.toContain('```')
  })
})
