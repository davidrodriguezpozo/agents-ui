import { describe, expect, it } from 'vitest'
import { summarizeTranscript } from '../server/utils/transcripts'

/**
 * A transcript is a conversation log with far more in it than the conversation:
 * subagent traffic, harness bookkeeping, and tool results wearing the user's
 * role. Picking out what a person actually said is what makes the list of
 * things-you-could-continue readable.
 */

const line = (entry: unknown) => `${JSON.stringify(entry)}\n`
const said = (text: string, extra: Record<string, unknown> = {}) =>
  line({ type: 'user', message: { content: [{ type: 'text', text }] }, ...extra })

describe('reading a transcript', () => {
  it('takes the title from the first thing the person said', () => {
    const raw = said('Fix the rounding bug in checkout') + said('Now add a test')

    expect(summarizeTranscript(raw)).toEqual({ title: 'Fix the rounding bug in checkout', turnCount: 2 })
  })

  it('ignores subagent traffic, which is not the conversation', () => {
    const raw = said('Review the migration') + said('inner agent chatter', { isSidechain: true })

    expect(summarizeTranscript(raw).turnCount).toBe(1)
  })

  it('ignores the harness talking to itself', () => {
    const raw = said('Real question', { isMeta: true }) + said('Actual question')

    expect(summarizeTranscript(raw)).toMatchObject({ title: 'Actual question', turnCount: 1 })
  })

  it('ignores assistant turns', () => {
    const raw = said('Question') + line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Answer' }] } })

    expect(summarizeTranscript(raw).turnCount).toBe(1)
  })

  it('ignores a tool result, which arrives wearing the user\'s role', () => {
    // These have no text of their own and would otherwise be counted as turns
    // and, worse, used as the title.
    const raw = said('<tool_result>40 lines</tool_result>') + said('The real question')

    expect(summarizeTranscript(raw)).toMatchObject({ title: 'The real question', turnCount: 1 })
  })

  it('accepts a plain string message as well as blocks', () => {
    expect(summarizeTranscript(line({ type: 'user', message: { content: 'Just a string' } })))
      .toMatchObject({ title: 'Just a string', turnCount: 1 })
  })

  it('skips a corrupt line rather than losing the whole transcript', () => {
    const raw = 'not json at all\n' + said('Still readable')

    expect(summarizeTranscript(raw)).toMatchObject({ title: 'Still readable', turnCount: 1 })
  })

  it('truncates a very long opening message', () => {
    const { title } = summarizeTranscript(said('x'.repeat(500)))

    expect(title).toHaveLength(120)
  })

  it('reports nothing for an empty or blank transcript', () => {
    expect(summarizeTranscript('')).toEqual({ title: null, turnCount: 0 })
    expect(summarizeTranscript('\n\n')).toEqual({ title: null, turnCount: 0 })
  })
})
