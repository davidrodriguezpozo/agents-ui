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

describe('reading back a conversation', () => {
  it('keeps what was said and drops what was not', async () => {
    // Assembled here rather than mocked: the shapes are the ones a real
    // transcript uses — a string for what a person typed, blocks for a reply.
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const home = await mkdtemp(join(tmpdir(), 'agents-ui-tx-'))
    process.env.CLAUDE_DIR = home

    const { readTranscriptMessages } = await import('../server/utils/transcripts')
    const { transcriptDirFor } = await import('../server/utils/sessionRecovery')

    const cwd = '/repo/thing'
    const dir = transcriptDirFor(cwd)
    await mkdir(dir, { recursive: true })

    await writeFile(join(dir, 'abc.jsonl'), [
      JSON.stringify({ type: 'user', message: { content: 'Fix the rounding bug' }, timestamp: '2026-08-04T10:00:00Z' }),
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'thinking', thinking: 'private reasoning nobody addressed' },
        { type: 'text', text: 'Found it in pricing.ts' },
      ] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: '40 lines' }] } }),
      JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'subagent' }] } }),
      JSON.stringify({ type: 'system', subtype: 'init' }),
      '',
    ].join('\n'), 'utf-8')

    const messages = await readTranscriptMessages(cwd, 'abc')

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', text: 'Fix the rounding bug' })
    expect(messages[1]).toMatchObject({ role: 'assistant', text: 'Found it in pricing.ts' })
    // Reading back private reasoning as though it were the reply would be wrong.
    expect(JSON.stringify(messages)).not.toContain('private reasoning')

    delete process.env.CLAUDE_DIR
    await (await import('node:fs/promises')).rm(home, { recursive: true, force: true })
  })

  it('says nothing when there is no such transcript', async () => {
    const { readTranscriptMessages } = await import('../server/utils/transcripts')

    await expect(readTranscriptMessages('/nowhere', 'missing')).resolves.toEqual([])
  })
})
