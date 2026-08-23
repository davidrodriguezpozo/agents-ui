import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelImage } from '~/utils/imageAttachments'

/**
 * What the two session endpoints do with images on the way in.
 *
 * Not the turn — that is a real Claude Code subprocess against a worktree, and
 * `liveSteer.test.ts` covers the blocks it is handed. What is decided here, and
 * only here, is which requests are allowed to become a turn at all: an image
 * with no words is a whole instruction, an empty request is still a 400, and
 * anything the browser would have refused is refused again on the way past,
 * because this endpoint is reachable by things that are not the browser.
 *
 * The turn path below it is stubbed, so what each test reads is the arguments it
 * was called with. Nitro's helpers are auto-imported rather than imported, so
 * they are stubbed too — the same arrangement as
 * `test/chatAttachmentsEndpoint.test.ts`.
 */

const sent: { input: string; images: ModelImage[] }[] = []
const steered: { input: string; images: ModelImage[] }[] = []

vi.mock('../server/utils/sessions', () => ({
  findSession: async (id: string) => (id === 'gone' ? null : { id, title: id }),
}))

vi.mock('../server/utils/sessionTurn', () => ({
  sendOrQueue: async (_session: unknown, input: string, images: ModelImage[]) => {
    sent.push({ input, images })
    return { runId: 'run-1' }
  },
  sendSteered: async (_session: unknown, input: string, images: ModelImage[]) => {
    steered.push({ input, images })
    return { steered: true, runId: 'run-1' }
  },
}))

interface FakeEvent { body: unknown }

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: FakeEvent) => event.body
globals.getRouterParam = () => 'session-1'
globals.createError = (init: { statusCode?: number; message?: string }) =>
  Object.assign(new Error(init.message ?? 'error'), { statusCode: init.statusCode })

/** A one-pixel PNG's worth of base64. Valid, and small enough to read. */
const png = 'iVBORw0KGgo='

const image = (patch: Record<string, unknown> = {}) => ({
  name: 'shot.png',
  mediaType: 'image/png',
  data: png,
  ...patch,
})

let message: (event: FakeEvent) => Promise<unknown>
let steer: (event: FakeEvent) => Promise<unknown>

beforeEach(async () => {
  sent.length = 0
  steered.length = 0
  message = (await import('../server/api/sessions/[id]/message.post')).default as unknown as typeof message
  steer = (await import('../server/api/sessions/[id]/steer.post')).default as unknown as typeof steer
})

describe('sending a session a message with images on it', () => {
  it('passes the images through with the words', async () => {
    await message({ body: { input: 'why is this off centre?', attachments: [image()] } })

    expect(sent).toEqual([{
      input: 'why is this off centre?',
      images: [{ name: 'shot.png', mediaType: 'image/png', data: png }],
    }])
  })

  it('takes an image with nothing typed under it', async () => {
    const result = await message({ body: { attachments: [image()] } })

    expect(result).toMatchObject({ runId: 'run-1' })
    expect(sent[0]!.input).toBe('')
    expect(sent[0]!.images).toHaveLength(1)
  })

  it('still refuses a request with neither', async () => {
    await expect(message({ body: { input: '   ' } })).rejects.toMatchObject({ statusCode: 400 })
    expect(sent).toEqual([])
  })

  it('drops an attachment the model would not accept, and keeps the sentence', async () => {
    await message({
      body: {
        input: 'and this one',
        attachments: [image({ name: 'notes.pdf', mediaType: 'application/pdf' }), image()],
      },
    })

    // The sentence is the part someone cares about most: a bad attachment must
    // not be a reason to lose it.
    expect(sent[0]!.input).toBe('and this one')
    expect(sent[0]!.images.map(i => i.name)).toEqual(['shot.png'])
  })

  it('refuses a request whose only attachment was refused', async () => {
    await expect(message({
      body: { attachments: [image({ mediaType: 'text/plain', name: 'notes.txt' })] },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('passes them to a running turn when steering instead', async () => {
    await steer({ body: { input: 'not that, this', attachments: [image()] } })

    expect(steered).toEqual([{
      input: 'not that, this',
      images: [{ name: 'shot.png', mediaType: 'image/png', data: png }],
    }])
  })

  it('lets a screenshot on its own be the correction', async () => {
    const result = await steer({ body: { attachments: [image()] } })

    expect(result).toMatchObject({ steered: true })
    expect(steered[0]!.images).toHaveLength(1)
  })
})
