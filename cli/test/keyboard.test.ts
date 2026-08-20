import { EventEmitter } from 'node:events'
import { createElement } from 'react'
import { render } from 'ink'
import { afterEach, describe, expect, it } from 'vitest'
import type { Api } from '../api'
import { createKeymap } from '../keymap'
import { App } from '../ui/App'
import type { Session, SessionDetail } from '../types'

/**
 * The keyboard, driven for real.
 *
 * Ink renders to any stream, so the app can be mounted on a fake terminal and
 * typed at — which is the only way to be sure that `⏎` moves the keys to the
 * pane, that `q` in a pane hands them back rather than quitting, that a chord
 * filters the rail without the letter also reaching it, and that the prompt
 * queue answers what it says it is answering.
 */

/**
 * Ink reads its input the way Node prefers: a `readable` event and then `read()`
 * until it comes back null. A fake that emitted `data` instead looks identical
 * and delivers nothing, which is worth knowing once.
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
  columns = 140
  rows = 44
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
    turns: [{
      id: 'r1',
      input: 'Look at the test',
      output: 'It waits on a timer.',
      status: 'completed',
      createdAt: 1,
    }],
    checkCommand: 'bun test',
    ...over,
  }
}

/** A tile with a prompt on it, which is where the queue gets its work. */
function tile(over: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    title: 'Fix the flaky terminal test',
    repo: 'agents-ui',
    branch: 'feat/flaky',
    runId: 'r1',
    activity: 'awaiting-permission',
    updatedAt: 5,
    turns: 1,
    pending: 1,
    prompts: [{
      id: 'p1',
      toolName: 'Bash',
      input: { command: 'gh pr create --fill' },
      canRemember: true,
      at: 1,
    }],
    ...over,
  }
}

interface Recorded {
  answers: { id: string; behavior: string; opts?: unknown }[]
  started: string[]
}

function api(over: Partial<Api> = {}, record?: Recorded): Api {
  const forever = (signal?: AbortSignal) => new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve()
    signal?.addEventListener('abort', () => resolve(), { once: true })
  })

  return {
    client: {
      projectDirValue: null,
      async *events(_path: string, options: { signal?: AbortSignal }) {
        await forever(options.signal)
      },
    },
    projects: async () => ({
      projects: [{
        path: '/repo',
        exists: true,
        isRepo: true,
        branch: 'main',
        hasClaudeDir: true,
        sessionCount: 1,
      }],
      activePath: '/repo',
      home: '/home',
    }),
    attention: async () => ({ blocked: 0, working: 0, failingRituals: 0, needsYou: 0, items: [] }),
    sessions: async (): Promise<Session[]> => [session()],
    runs: async () => [],
    session: async () => session(),
    diff: async () => ({ files: [], patch: PATCH }),
    wall: async () => ({
      at: 10,
      tiles: [],
      ticker: [],
      upcoming: [],
      landedToday: [],
      spend: { todayUsd: 2.4, capUsd: null },
      quota: null,
      day: { runs: 3, failed: 0, lastHour: 1 },
      liveSessions: 1,
      pausedRituals: 0,
    }),
    pulls: async () => ({
      ok: true,
      repo: 'x/y',
      viewer: 'me',
      reviewing: [],
      mine: [],
      summary: { onYou: 0, toReview: 0, toMerge: 0, waiting: 0 },
      readAt: 1,
    }),
    schedules: async () => [{
      id: 'r-1',
      title: 'Morning triage',
      input: 'triage the inbox',
      enabled: true,
      origin: 'user' as const,
      permission: 'edits' as const,
      description: 'every day at 08:00',
      createdAt: 1,
      lastRunAt: 2,
    }],
    scheduleHistory: async () => ({}),
    inbox: async () => ({ sources: [] }),
    answerPermission: async (id: string, behavior: string, opts?: unknown) => {
      record?.answers.push({ id, behavior, opts })
    },
    startSession: async (body: { prompt: string }) => {
      record?.started.push(body.prompt)
      return { id: 's-new' }
    },
    ...over,
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

async function mount(over: Partial<Api> = {}, record?: Recorded, columns = 140, rows = 44) {
  const stdin = new FakeStdin()
  const stdout = new FakeStdout()
  stdout.columns = columns
  stdout.rows = rows

  const instance = render(
    createElement(App, {
      api: api(over, record),
      baseUrl: 'http://127.0.0.1:3000',
      keys: createKeymap(),
    }),
    { stdin: stdin as never, stdout: stdout as never, patchConsole: false, exitOnCtrlC: false },
  )
  running = instance
  await settle()
  return { stdin, stdout, instance }
}

describe('the rail and the pane', () => {
  it('draws both at once, with the session in the pane beside the list', async () => {
    const { stdout } = await mount()
    // The rail says what it is showing and how much of it there is.
    expect(stdout.screen).toContain('EVERYTHING')
    expect(stdout.screen).toContain('Fix the flaky terminal test')
    // And the pane is already showing the first row rather than an empty state.
    expect(stdout.screen).toContain('feat/flaky → main')
    expect(stdout.screen).toContain('It waits on a timer.')
  })

  it('says which mode it is in, and which half has the keys', async () => {
    const { stdin, stdout } = await mount()
    expect(stdout.screen).toContain('RAIL')

    stdin.write('\r')
    await settle()
    expect(stdout.screen).toContain('PANE')

    stdin.write('\x1b')
    await settle()
    expect(stdout.screen).toContain('RAIL')
  })

  it('moves the keys with tab, both ways', async () => {
    const { stdin, stdout } = await mount()
    stdin.write('\t')
    await settle()
    expect(stdout.screen).toContain('PANE')
    stdin.write('\t')
    await settle()
    expect(stdout.screen).toContain('RAIL')
  })

  it('quits from the rail, and only hands the keys back from a pane', async () => {
    const { stdin, instance } = await mount()

    stdin.write('\r')
    await settle()
    stdin.write('q')
    await settle()

    let exited = false
    void instance.waitUntilExit().then(() => { exited = true })
    await settle()
    expect(exited).toBe(false)

    stdin.write('q')
    await instance.waitUntilExit()
    expect(exited).toBe(true)
  })

  it('filters with a chord, without the letter reaching the rail', async () => {
    const { stdin, stdout } = await mount()

    stdin.write('g')
    await settle(2)
    stdin.write('d')
    await settle()

    expect(stdout.screen).toContain('DAILY')
    expect(stdout.screen).toContain('Morning triage')
    expect(stdout.screen).not.toContain('Fix the flaky terminal test')
  })

  it('shows a half-typed count rather than swallowing it', async () => {
    const { stdin, stdout } = await mount()
    stdin.write('5')
    await settle(2)
    expect(stdout.screen).toContain('5')
  })

  it('takes turns on a narrow terminal instead of splitting', async () => {
    const { stdin, stdout } = await mount({}, undefined, 80)
    expect(stdout.screen).toContain('Fix the flaky terminal test')
    expect(stdout.screen).not.toContain('feat/flaky → main')

    stdin.write('\r')
    await settle()
    expect(stdout.screen).toContain('feat/flaky → main')
    expect(stdout.screen).not.toContain('EVERYTHING')
  })
})

describe('the layout', () => {
  /**
   * The one arithmetic bug this app can have that reads as corruption: Ink draws
   * the overflow on top of what is already there, so a pane that thinks it has
   * two rows more than it does writes its footer over its own last line. These
   * assertions are about height, which is exactly what cannot be eyeballed from
   * a screenshot.
   */
  it('fits the terminal it was given', async () => {
    const sizes: [number, number][] = [[140, 44], [100, 24], [80, 20], [200, 60]]
    for (const [columns, rows] of sizes) {
      const { stdout, instance } = await mount({}, undefined, columns, rows)
      const lines = stdout.screen.split('\n')
      expect(lines.length, `${columns}x${rows}`).toBeLessThanOrEqual(rows)
      expect(lines.every(line => line.length <= columns), `${columns}x${rows}`).toBe(true)
      // The footer is the last thing in the box, so its presence is the proof
      // that nothing above it grew and pushed it out.
      expect(stdout.screen, `${columns}x${rows}`).toContain('j k move')
      instance.unmount()
    }
  })

  it('keeps the footer when a session is open in the pane', async () => {
    const { stdin, stdout } = await mount({}, undefined, 120, 30)
    stdin.write('\r')
    await settle()

    expect(stdout.screen.split('\n').length).toBeLessThanOrEqual(30)
    expect(stdout.screen).toContain('i write')
  })

  it('never draws one line over another when the rail is too long for the window', async () => {
    /*
     * The failure this pins: Yoga shrinks a flex child that does not fit and Ink
     * draws the content anyway, so a two-line row squeezed to one renders its
     * detail *over* its title. On screen that reads as "the titles are missing",
     * which is impossible to diagnose from a screenshot and trivial to catch
     * here — a title and its detail are never on the same line.
     */
    const many = Array.from({ length: 40 }, (_, i) => session({
      id: `s${i}`,
      title: `Session number ${i} with a title long enough to be truncated`,
      updatedAt: 1_000 + i,
    }))

    const { stdout } = await mount({ sessions: async () => many }, undefined, 140, 24)
    const lines = stdout.screen.split('\n')

    expect(lines.some(line => line.includes('Session number'))).toBe(true)
    for (const line of lines) {
      const rail = line.slice(0, 46)
      // `Ready to land ·` is the detail; a title is `Session number …`. Both on
      // one line means one was drawn on top of the other.
      expect(rail.includes('Session number') && rail.includes('Ready to land ·')).toBe(false)
    }
  })

  it('never lets the transcript move the cursor', async () => {
    /*
     * The frame is a stream of bytes, and some of them are commands. A `\r` in a
     * session's text — a paste, a progress bar, anything from a Windows machine —
     * snaps the terminal to column 0 mid-row, and the rest of the line overwrites
     * the rail beside it. Colour codes from a test runner are the same class of
     * problem. This is the assertion that the frame carries text only.
     */
    const nasty = `Something went wrong\rand this overwrote the rail. `
      + `\x1b[31mred from a test runner\x1b[0m and \x1b]0;a new title\x07 too.`

    const { stdin, stdout } = await mount({
      session: async () => session({
        turns: [{ id: 'r1', input: nasty, output: nasty, status: 'completed', createdAt: 1 }],
      }),
    })

    stdin.write('\r')
    await settle()

    /*
     * Ink's own redraw sequences lead every frame, so the check is on what comes
     * after them: the content must carry no carriage return and no OSC, and the
     * words themselves must survive.
     */
    const frame = stdout.frames.at(-1) ?? ''
    const content = frame.slice(frame.indexOf('PANE') === -1 ? 0 : frame.indexOf('PANE'))
    expect(content).not.toContain('\r')
    expect(content).not.toContain('\x1b]')
    expect(content).not.toMatch(/\x1b\[[0-9;]*[ABDHJK]/)
    expect(stdout.screen).toContain('and this overwrote the rail')
    expect(stdout.screen).toContain('red from a test runner')
  })

  it('draws a row as a title and a reason to pick it', async () => {
    const { stdout } = await mount()
    expect(stdout.screen).toContain('Fix the flaky terminal test')
    expect(stdout.screen).toMatch(/Ready to land · feat\/flaky/)
  })
})

describe('the prompt queue', () => {
  const withPrompt = {
    wall: async (): Promise<never> => ({
      at: 10,
      tiles: [tile()],
      ticker: [],
      upcoming: [],
      landedToday: [],
      spend: { todayUsd: 0, capUsd: null },
      quota: null,
      day: { runs: 1, failed: 0, lastHour: 1 },
      liveSessions: 1,
      pausedRituals: 0,
    } as never),
  } as Partial<Api>

  it('opens on Y and shows what would actually happen', async () => {
    const { stdin, stdout } = await mount(withPrompt)

    stdin.write('Y')
    await settle()

    expect(stdout.screen).toContain('ANSWERING')
    expect(stdout.screen).toContain('1 waiting')
    // The command itself, not just "wants to run something".
    expect(stdout.screen).toContain('gh pr create --fill')
  })

  it('answers with one key and moves on', async () => {
    const record: Recorded = { answers: [], started: [] }
    const { stdin, stdout } = await mount(withPrompt, record)

    stdin.write('Y')
    await settle()
    stdin.write('y')
    await settle()

    expect(record.answers).toEqual([{ id: 'p1', behavior: 'allow', opts: { scope: 'once' } }])
    // Nothing left, and it says so rather than sitting on an answered prompt.
    expect(stdout.screen).toContain('Nothing is waiting')
  })

  it('denies with a reason worth reading', async () => {
    const record: Recorded = { answers: [], started: [] }
    const { stdin, stdout } = await mount(withPrompt, record)

    stdin.write('Y')
    await settle()
    stdin.write('N')
    await settle()
    expect(stdout.screen).toContain('no, because')

    stdin.write('use bun')
    await settle(2)
    stdin.write('\r')
    await settle()

    expect(record.answers).toEqual([{ id: 'p1', behavior: 'deny', opts: { message: 'use bun' } }])
  })

  it('says so plainly when there is nothing to answer', async () => {
    const { stdin, stdout } = await mount()
    stdin.write('Y')
    await settle()
    expect(stdout.screen).toContain('Nothing is waiting')
  })
})

describe('the command line', () => {
  it('filters the rail', async () => {
    const { stdin, stdout } = await mount()

    stdin.write(':')
    await settle()
    stdin.write('only daily')
    await settle(2)
    stdin.write('\r')
    await settle()

    expect(stdout.screen).toContain('DAILY')
  })

  it('starts a session on the rest of the line', async () => {
    const record: Recorded = { answers: [], started: [] }
    const { stdin } = await mount({}, record)

    stdin.write(':')
    await settle()
    stdin.write('new fix the flaky test')
    await settle(2)
    stdin.write('\r')
    await settle()

    expect(record.started).toEqual(['fix the flaky test'])
  })

  it('says what it does not understand', async () => {
    const { stdin, stdout } = await mount()

    stdin.write(':')
    await settle()
    stdin.write('wq')
    await settle(2)
    stdin.write('\r')
    await settle()

    expect(stdout.screen).toContain('Not a command: wq')
  })

  it('offers what could still be typed', async () => {
    const { stdin, stdout } = await mount()
    stdin.write(':')
    await settle()
    stdin.write('m')
    await settle(2)
    expect(stdout.screen).toContain('merge')
  })
})

describe('a session in the pane', () => {
  it('renders the agent’s Markdown rather than printing it', async () => {
    const output = [
      '## What I found',
      '',
      'The `useDebounce` hook never cleans up, so a **stale timer** fires after unmount.',
      '',
      '- one thing',
      '',
      '```ts',
      'clearTimeout(timer)',
      '```',
    ].join('\n')

    const { stdout } = await mount({
      session: async () => session({
        turns: [{ id: 'r1', input: 'Look', output, status: 'completed', createdAt: 1 }],
      }),
    })

    const screen = stdout.screen
    expect(screen).toContain('What I found')
    expect(screen).not.toContain('## What I found')
    expect(screen).toContain('stale timer')
    expect(screen).not.toContain('**stale timer**')
    expect(screen).toContain('• one thing')
    expect(screen).toContain('clearTimeout(timer)')
    expect(screen).not.toContain('```')
  })

  it('shows the diff on d and walks it by file on n', async () => {
    const { stdin, stdout } = await mount()

    stdin.write('\r')
    await settle()
    stdin.write('d')
    await settle()

    expect(stdout.screen).toContain('2 files  +2/−0')
    expect(stdout.screen).toContain('first file')

    stdin.write('n')
    await settle()
    expect(stdout.screen).toContain('server/two.ts')

    stdin.write('d')
    await settle()
    expect(stdout.screen).toContain('It waits on a timer.')
  })

  it('answers a prompt while the checks are running', async () => {
    const record: Recorded = { answers: [], started: [] }
    let checksStarted = false
    const forever = () => new Promise<void>(() => {})

    const { stdin } = await mount({
      session: async () => session({ status: 'running', activity: 'awaiting-permission' }),
      sessions: async () => [session({ status: 'running', activity: 'awaiting-permission' })],
      runChecks: async () => {
        checksStarted = true
        await forever()
        return { check: undefined }
      },
      client: {
        projectDirValue: null,
        async *events(path: string, options: { signal?: AbortSignal }) {
          if (path.includes('/api/runs/')) {
            yield { type: 'status', status: 'running', seq: 0 }
            yield {
              type: 'permission_request',
              seq: 1,
              request: {
                id: 'p9',
                ownerId: 'r1',
                toolName: 'Bash',
                input: { command: 'rm -rf node_modules' },
                canRemember: true,
                suggestedRules: [],
                createdAt: 1,
              },
            }
          }
          await new Promise<void>((resolve) => {
            options.signal?.addEventListener('abort', () => resolve(), { once: true })
          })
        },
      },
    } as never, record)

    stdin.write('\r')
    await settle()
    stdin.write('c')
    await settle()
    expect(checksStarted).toBe(true)

    // The bug this replaces: one shared busy flag meant `y` returned early and
    // said nothing until the ten-minute check finished.
    stdin.write('y')
    await settle()
    expect(record.answers).toEqual([{ id: 'p9', behavior: 'allow', opts: { scope: 'once' } }])
  })
})

describe('the help page', () => {
  it('shows the keys for where you are, off the table the footers read', async () => {
    const { stdin, stdout } = await mount()

    stdin.write('?')
    await settle()
    expect(stdout.screen).toContain('EVERYWHERE')
    expect(stdout.screen).toContain('THE RAIL')
    expect(stdout.screen).toContain('Answer everything that is waiting')

    stdin.write('?')
    await settle()
    expect(stdout.screen).toContain('EVERYTHING')
  })
})

describe('what it did', () => {
  /**
   * The steps arrive folded.
   *
   * Thirty tool calls is thirty lines, and a transcript that is mostly file
   * reads pushes the answer off the bottom of the screen. Toning the colour
   * down made them quieter without making them shorter — so the pane draws one
   * line with a count on it, and `z` opens the turn you are reading.
   */
  const busy = () => session({
    turns: [{
      id: 'r1',
      input: 'Look at the test',
      output: 'It waits on a timer.',
      status: 'completed',
      createdAt: 1,
      toolCalls: [
        { id: 't1', toolName: 'Read', input: { file_path: '/repo/.worktrees/s1/cli/terminal.ts' } },
        { id: 't2', toolName: 'Read', input: { file_path: '/repo/.worktrees/s1/cli/test/terminal.test.ts' } },
        { id: 't3', toolName: 'Bash', input: { command: 'bun test --filter flaky-terminal' } },
      ],
    }],
  })

  it('folds to a count, and z opens and closes it', async () => {
    const { stdin, stdout } = await mount({ session: async () => busy() })
    stdin.write('\r')
    await settle()

    expect(stdout.screen).toContain('3 steps')
    expect(stdout.screen).toContain('Read ×2')
    expect(stdout.screen).not.toContain('bun test --filter flaky-terminal')

    stdin.write('z')
    await settle()
    expect(stdout.screen).toContain('bun test --filter flaky-terminal')

    stdin.write('z')
    await settle()
    expect(stdout.screen).not.toContain('bun test --filter flaky-terminal')
  })

  it('opens every turn on Z', async () => {
    const { stdin, stdout } = await mount({ session: async () => busy() })
    stdin.write('\r')
    await settle()

    stdin.write('Z')
    await settle()
    expect(stdout.screen).toContain('bun test --filter flaky-terminal')
  })
})
