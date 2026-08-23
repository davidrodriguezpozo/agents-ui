import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * The messages you type while a turn is running.
 *
 * These exercise the queue itself — order, removal, and the fact that both ends
 * write to it at once — rather than the sending. Starting the turn is
 * `startTurn`, which is the same code path a message typed into an idle session
 * takes and is covered by being that.
 */

let claudeDir: string
/** A real directory, because a session with no workspace refuses turns. */
let worktree: string
let sessions: typeof import('../server/utils/sessions')
let queue: typeof import('../server/utils/sessionQueue')
let turn: typeof import('../server/utils/sessionTurn')
let runStore: typeof import('../server/utils/runStore')
let attachments: typeof import('../server/utils/queuedAttachments')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-queue-'))
  worktree = await mkdtemp(join(tmpdir(), 'agents-ui-queue-work-'))
  process.env.CLAUDE_DIR = claudeDir

  sessions = await import('../server/utils/sessions')
  queue = await import('../server/utils/sessionQueue')
  turn = await import('../server/utils/sessionTurn')
  runStore = await import('../server/utils/runStore')
  attachments = await import('../server/utils/queuedAttachments')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(worktree, { recursive: true, force: true })
})

let counter = 0
async function session(patch: Partial<import('../server/utils/sessions').Session> = {}) {
  const id = `queue-${++counter}`
  return sessions.saveSession({
    id,
    title: id,
    repoDir: worktree,
    worktreePath: worktree,
    branch: id,
    baseBranch: 'main',
    baseSha: 'deadbeef',
    status: 'running',
    runIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...patch,
  })
}

/**
 * A turn in flight, without running one: what "busy" is read from is the run's
 * status, so a run left `running` is a session mid-turn as far as everything
 * here is concerned.
 */
async function workingSession(patch: Partial<import('../server/utils/sessions').Session> = {}) {
  const s = await session(patch)
  const run = runStore.createRun({
    kind: 'chat',
    title: 'the turn already going',
    input: 'the turn already going',
    projectDir: s.worktreePath,
    sessionId: s.id,
  })
  runStore.setStatus(run.id, 'running')

  return sessions.saveSession({ ...s, status: 'running', runIds: [run.id], ...patch })
}

const textsOf = async (id: string) =>
  ((await sessions.findSession(id))?.queued ?? []).map(m => m.text)

describe('the queue on a session', () => {
  it('keeps what was typed, in the order it was typed', async () => {
    const s = await session()

    await queue.queueMessage(s.id, 'first')
    await queue.queueMessage(s.id, 'second')

    expect(await textsOf(s.id)).toEqual(['first', 'second'])
  })

  it('trims, and refuses a message with nothing in it', async () => {
    const s = await session()

    expect(await queue.queueMessage(s.id, '  spaced out  ')).toMatchObject({ text: 'spaced out' })
    expect(await queue.queueMessage(s.id, '   \n  ')).toBeNull()

    expect(await textsOf(s.id)).toEqual(['spaced out'])
  })

  it('sends the oldest first, one turn at a time', async () => {
    const s = await session()
    await queue.queueMessage(s.id, 'first')
    await queue.queueMessage(s.id, 'second')

    expect((await queue.takeQueuedMessage(s.id))?.text).toBe('first')
    expect(await textsOf(s.id)).toEqual(['second'])
    expect((await queue.takeQueuedMessage(s.id))?.text).toBe('second')
    expect(await queue.takeQueuedMessage(s.id)).toBeNull()
  })

  it('puts a message that could not be sent back at the front', async () => {
    const s = await session()
    await queue.queueMessage(s.id, 'first')
    await queue.queueMessage(s.id, 'second')

    const next = (await queue.takeQueuedMessage(s.id))!
    await queue.queueMessage(s.id, 'third')
    await queue.requeueMessage(s.id, next)

    // Still the next thing you meant to say, and still ahead of what followed.
    expect(await textsOf(s.id)).toEqual(['first', 'second', 'third'])
  })

  it('removes one by id and leaves the rest standing', async () => {
    const s = await session()
    await queue.queueMessage(s.id, 'first')
    const middle = (await queue.queueMessage(s.id, 'second'))!
    await queue.queueMessage(s.id, 'third')

    await queue.dropQueuedMessage(s.id, middle.id)

    expect(await textsOf(s.id)).toEqual(['first', 'third'])
  })

  it('gives every message an id of its own, so identical text is still two rows', async () => {
    const s = await session()
    const a = (await queue.queueMessage(s.id, 'again'))!
    const b = (await queue.queueMessage(s.id, 'again'))!

    expect(a.id).not.toBe(b.id)

    await queue.dropQueuedMessage(s.id, a.id)
    expect(await textsOf(s.id)).toEqual(['again'])
  })

  it('empties on request — a closed session is not coming back for these', async () => {
    const s = await session()
    await queue.queueMessage(s.id, 'first')
    await queue.queueMessage(s.id, 'second')

    await queue.clearQueue(s.id)

    expect(await textsOf(s.id)).toEqual([])
  })

  /**
   * The queue is the one field written from both ends at once: you add to the
   * back while a turn that has just ended takes from the front. A read-then-
   * write of the whole array is how one of the two silently loses, so the words
   * are put in all at once here to prove they cannot.
   */
  it('loses nothing when several messages are queued at the same moment', async () => {
    const s = await session()
    const words = ['one', 'two', 'three', 'four', 'five', 'six']

    await Promise.all(words.map(word => queue.queueMessage(s.id, word)))

    expect((await textsOf(s.id)).sort()).toEqual([...words].sort())
  })

  it('does not take the same message twice when two flushes race', async () => {
    const s = await session()
    await queue.queueMessage(s.id, 'only one of us gets this')

    const [a, b] = await Promise.all([
      queue.takeQueuedMessage(s.id),
      queue.takeQueuedMessage(s.id),
    ])

    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(await textsOf(s.id)).toEqual([])
  })

  it('says nothing happened for a session that is not there', async () => {
    expect(await queue.queueMessage('no-such-session', 'hello')).toBeNull()
    expect(await queue.takeQueuedMessage('no-such-session')).toBeNull()
    expect(await queue.dropQueuedMessage('no-such-session', 'x')).toBeNull()
  })

  it('leaves a session with nothing queued alone', async () => {
    const s = await session()
    await queue.clearQueue(s.id)
    expect((await sessions.findSession(s.id))?.queued).toBeUndefined()
  })
})

/**
 * The decision that used to be a disabled textarea: whether what you typed
 * starts a turn or waits for one. Made on the server, because the page's idea
 * of busy is as old as its last load.
 *
 * Only the paths that do not start a turn are exercised here — starting one
 * spawns an agent against a worktree, which is the run subsystem's own ground.
 */
describe('sending into a session that is already working', () => {
  it('keeps the message rather than refusing it', async () => {
    const s = await workingSession()

    const result = await turn.sendOrQueue(s, 'and rename the other one too')

    expect(result.runId).toBeUndefined()
    expect(result.queued).toMatchObject({ text: 'and rename the other one too' })
    expect(await textsOf(s.id)).toEqual(['and rename the other one too'])
  })

  it('reads busy from the run, not from the status on the record', async () => {
    const s = await workingSession({ status: 'idle' })
    expect(await turn.isTurnRunning(s)).toBe(true)

    const result = await turn.sendOrQueue(s, 'queued anyway')
    expect(result.queued).toBeTruthy()
  })

  it('leaves the queue alone while the turn it is waiting for is still going', async () => {
    const s = await workingSession()
    await queue.queueMessage(s.id, 'first')

    expect(await turn.flushQueue(s.id)).toBeNull()
    expect(await textsOf(s.id)).toEqual(['first'])
  })

  it('refuses a closed session outright, queue or no queue', async () => {
    const s = await workingSession({ status: 'archived' })

    // The refusal travels in `data`, which is what the page reads to say why.
    await expect(turn.sendOrQueue(s, 'anything')).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'session_closed' },
    })
    expect(await textsOf(s.id)).toEqual([])
  })

  it('drops a queue nothing is ever going to send', async () => {
    const s = await workingSession()
    await queue.queueMessage(s.id, 'never going anywhere')
    await sessions.patchSession(s.id, { status: 'archived' })

    expect(await turn.flushQueue(s.id)).toBeNull()
    expect(await textsOf(s.id)).toEqual([])
  })

  it('has nothing to say about a session with an empty queue', async () => {
    const s = await workingSession()
    expect(await turn.flushQueue(s.id)).toBeNull()
  })
})

/**
 * Images on a message that is waiting rather than being sent.
 *
 * The bytes go on disk and the record keeps a reference, because the queue's
 * whole reason for existing is outliving the tab — see `queuedAttachments`.
 * What is proved here is the pairing: every path that removes a message from
 * the queue also removes what it was holding, and the one path that puts a
 * message back leaves the files where the retry can still find them.
 */
describe('images waiting in the queue', () => {
  const shot = (name = 'shot.png') => ({
    name,
    mediaType: 'image/png' as const,
    // 'hi', which is two bytes decoded — enough to prove the round trip.
    data: 'aGk=',
  })

  it('keeps the bytes on disk and only a reference on the session', async () => {
    const s = await session()

    const message = await queue.queueMessage(s.id, 'why is this off centre?', [shot()])

    expect(message?.attachments).toEqual([
      { id: `${message!.id}-0`, name: 'shot.png', mediaType: 'image/png', size: 2 },
    ])
    // Nothing on the record that a JSON file cannot afford.
    expect(JSON.stringify(await sessions.findSession(s.id))).not.toContain('aGk=')
    expect(await attachments.countQueuedAttachments(s.id)).toBe(1)
  })

  it('reads them back for the turn that finally takes the message', async () => {
    const s = await session()
    await queue.queueMessage(s.id, 'look', [shot(), shot('other.png')])

    const next = (await queue.takeQueuedMessage(s.id))!
    expect(await attachments.loadQueuedAttachments(s.id, next.attachments)).toEqual([
      { name: 'shot.png', mediaType: 'image/png', data: 'aGk=' },
      { name: 'other.png', mediaType: 'image/png', data: 'aGk=' },
    ])
  })

  it('takes an image with nothing typed under it, and refuses neither', async () => {
    const s = await session()

    expect(await queue.queueMessage(s.id, '  ', [shot()])).toBeTruthy()
    expect(await queue.queueMessage(s.id, '   ')).toBeNull()
  })

  it('forgets the files when the message is taken back out', async () => {
    const s = await session()
    const message = await queue.queueMessage(s.id, 'never mind', [shot()])

    await queue.dropQueuedMessage(s.id, message!.id)

    expect(await attachments.countQueuedAttachments(s.id)).toBe(0)
  })

  it('forgets all of them when the queue is dropped', async () => {
    const s = await session()
    await queue.queueMessage(s.id, 'one', [shot()])
    await queue.queueMessage(s.id, 'two', [shot()])

    await queue.clearQueue(s.id)

    expect(await attachments.countQueuedAttachments(s.id)).toBe(0)
  })

  it('forgets them when the session itself goes', async () => {
    const s = await session()
    await queue.queueMessage(s.id, 'one', [shot()])

    await sessions.deleteSession(s.id)

    expect(await attachments.countQueuedAttachments(s.id)).toBe(0)
  })

  it('keeps the files behind a message that was put back', async () => {
    const s = await session()
    const message = await queue.queueMessage(s.id, 'still meant it', [shot()])

    const taken = (await queue.takeQueuedMessage(s.id))!
    await queue.requeueMessage(s.id, taken)

    // A turn that would not start is why this happens, and the next attempt has
    // to be able to read the same images.
    expect(await attachments.countQueuedAttachments(s.id)).toBe(1)
    expect(await attachments.loadQueuedAttachments(s.id, taken.attachments)).toHaveLength(1)
    expect(message!.attachments).toEqual(taken.attachments)
  })

  it('skips a reference whose file has gone rather than failing the turn', async () => {
    const s = await session()
    const message = await queue.queueMessage(s.id, 'look', [shot()])

    await attachments.clearQueuedAttachments(s.id)

    expect(await attachments.loadQueuedAttachments(s.id, message!.attachments)).toEqual([])
  })
})
