import { describe, expect, it } from 'vitest'
import { chatPrompt, userTurn } from '../server/utils/chatPrompt'
import type { ModelImage } from '../app/utils/imageAttachments'

const shot: ModelImage = { name: 'shot.png', mediaType: 'image/png', data: 'AAAA' }

describe('chatPrompt', () => {
  it('is the text itself when nothing was attached', () => {
    expect(chatPrompt('what is wrong here', [])).toBe('what is wrong here')
  })

  it('becomes a one-message stream when an image came with it', async () => {
    const prompt = chatPrompt('what is wrong here', [shot])
    expect(typeof prompt).not.toBe('string')

    const sent = []
    for await (const message of prompt as AsyncIterable<unknown>) sent.push(message)
    expect(sent).toHaveLength(1)
  })
})

describe('userTurn', () => {
  it('puts the images before the question', () => {
    expect(userTurn('what is wrong here', [shot]).message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'what is wrong here' },
    ])
  })

  it('sends an image on its own without an empty text block', () => {
    // "Look at this" is a complete message; a blank text block is one more
    // thing for the model to interpret.
    expect(userTurn('   ', [shot]).message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ])
  })

  it('keeps every image, in the order they were attached', () => {
    const second: ModelImage = { name: 'after.webp', mediaType: 'image/webp', data: 'BBBB' }
    const content = userTurn('before and after', [shot, second]).message.content as { source?: { data: string } }[]

    expect(content.map(block => block.source?.data)).toEqual(['AAAA', 'BBBB', undefined])
  })

  it('leaves the session to the query options', () => {
    // The same value the SDK writes for a string prompt — the CLI assigns the
    // real one, and which session is resumed is not said here.
    const turn = userTurn('hello', [shot])
    expect(turn.session_id).toBe('')
    expect(turn.parent_tool_use_id).toBeNull()
    expect(turn.type).toBe('user')
  })
})
