import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Getting a sentence into a turn that is already running.
 *
 * Two things are being proved here. The channel itself — what the SDK is handed
 * as a prompt, which has to yield the opening instruction, then anything typed
 * into the turn, then end — and the decision above it: whether what you typed
 * steers the running turn, starts one, or waits.
 *
 * The turn is faked the way `sessionQueue.test.ts` fakes it, by leaving a run in
 * `running`, because that is what everything here reads "busy" from. Running a
 * real turn spawns an agent against a worktree and is the run subsystem's ground.
 */

let claudeDir: string
let worktree: string
let sessions: typeof import('../server/utils/sessions')
let queue: typeof import('../server/utils/sessionQueue')
let turn: typeof import('../server/utils/sessionTurn')
let runStore: typeof import('../server/utils/runStore')
let steer: typeof import('../server/utils/liveSteer')
let preferences: typeof import('../server/utils/preferences')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-steer-'))
  worktree = await mkdtemp(join(tmpdir(), 'agents-ui-steer-work-'))
  process.env.CLAUDE_DIR = claudeDir

  sessions = await import('../server/utils/sessions')
  queue = await import('../server/utils/sessionQueue')
  turn = await import('../server/utils/sessionTurn')
  runStore = await import('../server/utils/runStore')
  steer = await import('../server/utils/liveSteer')
  preferences = await import('../server/utils/preferences')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(worktree, { recursive: true, force: true })
})

let counter = 0

async function session(patch: Partial<import('../server/utils/sessions').Session> = {}) {
  const id = `steer-${++counter}`
  return sessions.saveSession({
    id,
    title: id,
    repoDir: worktree,
    worktreePath: worktree,
    branch: id,
    baseBranch: 'main',
    baseSha: 'deadbeef',
    status: 'idle',
    runIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...patch,
  })
}

/** A run left `running`, which is a turn in flight as far as this code reads. */
function runningRun(sessionId?: string) {
  const run = runStore.createRun({
    kind: 'chat',
    title: 'the turn already going',
    input: 'the turn already going',
    projectDir: worktree,
    sessionId,
  })
  runStore.setStatus(run.id, 'running')
  return run
}

/** A session mid-turn, with the channel its run would have opened. */
async function steerableSession(patch: Partial<import('../server/utils/sessions').Session> = {}) {
  const s = await session(patch)
  const run = runningRun(s.id)
  const prompt = steer.openSteerChannel(run.id, 'the turn already going')
  const saved = await sessions.saveSession({
    ...s, status: 'running', runIds: [run.id], ...patch,
  })
  return { session: saved, run, prompt }
}

const textOf = (message: SDKUserMessage) =>
  (message.message.content as { text: string }[])[0]!.text

const textsOf = async (id: string) =>
  ((await sessions.findSession(id))?.queued ?? []).map(m => m.text)

const steersOf = (runId: string) =>
  (runStore.getActive(runId)?.run.events ?? [])
    .filter(e => e.type === 'steer')
    .map(e => e.text)

describe('the channel a running turn reads its input from', () => {
  it('yields the opening instruction first, then waits rather than ending', async () => {
    const run = runningRun()
    const prompt = steer.openSteerChannel(run.id, 'rename the widget')
    const reader = prompt[Symbol.asyncIterator]()

    expect(textOf((await reader.next()).value!)).toBe('rename the widget')

    // Nothing else yet, and — the whole point — not `done` either. A generator
    // that returned here is a stdin the CLI has seen the end of.
    const pending = reader.next()
    let settled = false
    void pending.then(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(settled).toBe(false)

    steer.closeSteerChannel(run.id)
    expect((await pending).done).toBe(true)
  })

  it('hands over what was said into the turn, in the order it was said', async () => {
    const run = runningRun()
    const prompt = steer.openSteerChannel(run.id, 'opening')
    const reader = prompt[Symbol.asyncIterator]()
    await reader.next()

    expect(steer.steerRun(run.id, 'not that file')).toBe(true)
    expect(steer.steerRun(run.id, 'the other one')).toBe(true)

    expect(textOf((await reader.next()).value!)).toBe('not that file')
    expect(textOf((await reader.next()).value!)).toBe('the other one')

    steer.closeSteerChannel(run.id)
  })

  it('records each one as it goes to the CLI, not when it was accepted', async () => {
    const run = runningRun()
    const prompt = steer.openSteerChannel(run.id, 'opening')
    const reader = prompt[Symbol.asyncIterator]()
    await reader.next()

    steer.steerRun(run.id, 'not that file')
    // Accepted, not yet handed over: nothing on the record claims otherwise.
    expect(steersOf(run.id)).toEqual([])

    await reader.next()
    expect(steersOf(run.id)).toEqual(['not that file'])

    steer.closeSteerChannel(run.id)
  })

  it('trims, and refuses a message with nothing in it', async () => {
    const run = runningRun()
    steer.openSteerChannel(run.id, 'opening')

    expect(steer.steerRun(run.id, '   \n ')).toBe(false)
    expect(steer.steerRun(run.id, '  not that file  ')).toBe(true)

    expect(steer.closeSteerChannel(run.id)).toEqual(['not that file'])
  })

  it('takes nothing once the input is closed', async () => {
    const run = runningRun()
    steer.openSteerChannel(run.id, 'opening')

    expect(steer.steerRun(run.id, 'in time')).toBe(true)
    steer.closeSteerChannel(run.id)

    expect(steer.steerRun(run.id, 'too late')).toBe(false)
  })

  it('hands back what it never delivered, so the caller can queue it instead', async () => {
    const run = runningRun()
    steer.openSteerChannel(run.id, 'opening')

    steer.steerRun(run.id, 'first')
    steer.steerRun(run.id, 'second')

    expect(steer.closeSteerChannel(run.id)).toEqual(['first', 'second'])
    // Closing twice is the ordinary case — on the result, then on teardown.
    expect(steer.closeSteerChannel(run.id)).toEqual([])
  })

  it('refuses a run that has stopped, however open its channel looks', async () => {
    const run = runningRun()
    steer.openSteerChannel(run.id, 'opening')
    runStore.setStatus(run.id, 'cancelled')

    expect(steer.steerRun(run.id, 'too late')).toBe(false)
  })

  it('refuses a run it has never heard of', () => {
    expect(steer.steerRun('no-such-run', 'hello')).toBe(false)
    expect(steer.closeSteerChannel('no-such-run')).toEqual([])
  })
})

describe('what happens to a message meant for the running turn', () => {
  it('reaches the turn, and is not queued behind it', async () => {
    const { session: s, run, prompt } = await steerableSession()
    const reader = prompt[Symbol.asyncIterator]()
    await reader.next()

    const result = await turn.sendSteered(s, 'no, not that file')

    expect(result).toEqual({ steered: true, runId: run.id })
    expect(textOf((await reader.next()).value!)).toBe('no, not that file')
    expect(await textsOf(s.id)).toEqual([])

    steer.closeSteerChannel(run.id)
  })

  it('queues when a turn is running that will not take it', async () => {
    // A turn in flight whose channel is already closed: the result arrived, the
    // run has not been torn down yet. This is the window the button races.
    const { session: s, run } = await steerableSession()
    steer.closeSteerChannel(run.id)

    const result = await turn.sendSteered(s, 'no, not that file')

    expect(result.steered).toBeUndefined()
    expect(result.queued).toMatchObject({ text: 'no, not that file' })
    expect(await textsOf(s.id)).toEqual(['no, not that file'])
  })

  /**
   * With nothing running there is nothing to steer, so this becomes an ordinary
   * send — which means starting a turn, which spawns an agent against a
   * worktree and is not this test's business.
   *
   * So the day's allowance is spent first. `startTurn` is the only thing that
   * consults the budget, and it does so before touching the workspace or
   * spending anything, so the 429 coming back is proof of the path taken: not
   * steered, not queued, straight into the ordinary send.
   */
  it('takes the ordinary send path when the turn ended before the press', async () => {
    const { session: s, run } = await steerableSession()
    steer.closeSteerChannel(run.id)
    runStore.setStatus(run.id, 'completed')

    const spent = runningRun()
    runStore.getActive(spent.id)!.run.stats = {
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      costUsd: 5,
      durationMs: 0,
      numTurns: 1,
      permissionDenials: [],
    }
    runStore.setStatus(spent.id, 'completed')

    await preferences.savePreferences({ dailyCapUsd: 0.01 })
    try {
      await expect(turn.sendSteered(s, 'do this instead')).rejects.toMatchObject({
        statusCode: 429,
        data: { error: 'over_budget' },
      })
    } finally {
      await preferences.savePreferences({ dailyCapUsd: 0 })
    }

    expect(await textsOf(s.id)).toEqual([])
  })

  it('waits behind anything already queued rather than jumping it', async () => {
    const { session: s, run } = await steerableSession()
    await queue.queueMessage(s.id, 'said ten minutes ago')
    steer.closeSteerChannel(run.id)

    const fresh = (await sessions.findSession(s.id))!
    await turn.sendSteered(fresh, 'said just now')

    expect(await textsOf(s.id)).toEqual(['said ten minutes ago', 'said just now'])
  })

  it('refuses a closed session outright, running turn or not', async () => {
    const { session: s } = await steerableSession({ status: 'archived' })

    await expect(turn.sendSteered(s, 'anything')).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'session_closed' },
    })
    expect(await textsOf(s.id)).toEqual([])
  })
})
