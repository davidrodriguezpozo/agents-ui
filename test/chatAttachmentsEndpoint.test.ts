import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What `POST /api/chat` hands to the SDK when a message carries images.
 *
 * The turn itself cannot be run here — that is a real Claude Code subprocess
 * and a paid API call — so the SDK is stubbed and what this checks is the one
 * decision the endpoint makes: a plain string for a text turn, a user message
 * with image blocks when something was attached, and a 400 only when there is
 * genuinely nothing to send.
 *
 * Nitro's helpers are auto-imported rather than imported, so they are stubbed,
 * the same arrangement `test/editorEndpoint.test.ts` describes.
 */

const queryCalls: { prompt: unknown; options: Record<string, unknown> }[] = []

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: unknown; options: Record<string, unknown> }) => {
    queryCalls.push(args)
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: 'looked at it', session_id: 'abc' }
    })()
  },
}))

interface FakeEvent {
  body?: unknown
  node: {
    req: { on: (event: string, listener: () => void) => void }
    res: { write: (chunk: string) => void; end: () => void; writableEnded: boolean }
  }
  written: string[]
}

function fakeEvent(body: unknown): FakeEvent {
  const written: string[] = []
  return {
    body,
    written,
    node: {
      req: { on: () => {} },
      res: { write: (chunk: string) => written.push(chunk), end: () => {}, writableEnded: false },
    },
  }
}

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: FakeEvent) => event.body
globals.createError = (init: { statusCode?: number; message?: string }) =>
  Object.assign(new Error(init.message ?? 'error'), { statusCode: init.statusCode })
globals.setResponseHeaders = () => {}
globals.getHeader = () => undefined
globals.getQuery = () => ({})

const png = 'iVBORw0KGgo='

let chat: (event: FakeEvent) => Promise<void>
let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-chat-api-'))
  process.env.CLAUDE_DIR = dir
  chat = (await import('../server/api/chat.post')).default as unknown as typeof chat
})

afterAll(async () => {
  delete process.env.CLAUDE_DIR
  await rm(dir, { recursive: true, force: true })
})

beforeEach(() => {
  queryCalls.length = 0
})

/** The blocks of the single user message a streamed prompt carries. */
async function blocksOf(prompt: unknown): Promise<unknown[]> {
  const messages: { message: { content: unknown[] } }[] = []
  for await (const message of prompt as AsyncIterable<{ message: { content: unknown[] } }>) {
    messages.push(message)
  }
  expect(messages).toHaveLength(1)
  return messages[0]!.message.content
}

describe('POST /api/chat with images', () => {
  it('sends a plain string when nothing was attached', async () => {
    const event = fakeEvent({ messages: [{ role: 'user', content: 'hello' }] })
    await chat(event)

    expect(queryCalls).toHaveLength(1)
    expect(queryCalls[0]!.prompt).toBe('hello')
    // Still a normal turn on the way back out.
    expect(event.written.join('')).toContain('"text":"looked at it"')
  })

  it('sends the image with the question', async () => {
    await chat(fakeEvent({
      messages: [{ role: 'user', content: 'what is wrong here' }],
      attachments: [{ name: 'shot.png', mediaType: 'image/png', data: png }],
    }))

    expect(await blocksOf(queryCalls[0]!.prompt)).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
      { type: 'text', text: 'what is wrong here' },
    ])
  })

  it('accepts an image with nothing typed under it', async () => {
    // The 400 this replaced: "look at this" is what dropping the image said.
    await chat(fakeEvent({
      messages: [{ role: 'user', content: '' }],
      attachments: [{ name: 'shot.png', mediaType: 'image/png', data: png }],
    }))

    expect(await blocksOf(queryCalls[0]!.prompt)).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
    ])
  })

  it('drops an attachment that is not an image, keeping the sentence', async () => {
    await chat(fakeEvent({
      messages: [{ role: 'user', content: 'and this?' }],
      attachments: [{ name: 'notes.pdf', mediaType: 'application/pdf', data: png }],
    }))

    expect(queryCalls[0]!.prompt).toBe('and this?')
  })

  it('refuses a turn with neither text nor a usable image', async () => {
    await expect(chat(fakeEvent({
      messages: [{ role: 'user', content: '   ' }],
      attachments: [{ name: 'notes.pdf', mediaType: 'application/pdf', data: png }],
    }))).rejects.toThrow('The last message is empty')

    expect(queryCalls).toHaveLength(0)
  })
})
