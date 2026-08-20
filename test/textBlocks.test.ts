import { describe, expect, it } from 'vitest'
import { paragraphBreaks } from '../server/utils/textBlocks'

/** The shape of a real turn: text, a tool call, then text again. */
function stream(breaks: ReturnType<typeof paragraphBreaks>, deltas: string[][]): string {
  let out = ''
  for (const [index, block] of deltas.entries()) {
    if (index > 0) breaks.startBlock('text')
    for (const delta of block) out += breaks.delta('text', delta) ?? ''
  }
  return out
}

describe('paragraphBreaks', () => {
  it('opens a paragraph for every block after the first', () => {
    const breaks = paragraphBreaks()
    const out = stream(breaks, [
      ['Let me read the pieces ', "I'll be modifying."],
      ['Now I have what ', 'I need.'],
    ])

    // The bug this exists for: "…modifying.Now I have what I need."
    expect(out).toBe("Let me read the pieces I'll be modifying.\n\nNow I have what I need.")
  })

  it('does not open the answer with blank lines', () => {
    const breaks = paragraphBreaks()
    expect(breaks.delta('text', 'Starting.')).toBe('Starting.')
  })

  it('leaves the deltas within one block untouched', () => {
    const breaks = paragraphBreaks()
    const out = stream(breaks, [['A sentence. ', 'And another one.']])
    expect(out).toBe('A sentence. And another one.')
  })

  it('waits for the first real word when a block opens on whitespace', () => {
    const breaks = paragraphBreaks()
    breaks.delta('text', 'Done.')
    breaks.startBlock('text')

    expect(breaks.delta('text', '\n\n')).toBeNull()
    expect(breaks.delta('text', '  ')).toBeNull()
    expect(breaks.delta('text', '\n  Next')).toBe('\n\nNext')
    expect(breaks.delta('text', ' paragraph.')).toBe(' paragraph.')
  })

  it('keeps thinking and text apart', () => {
    const breaks = paragraphBreaks()

    breaks.startBlock('thinking')
    expect(breaks.delta('thinking', 'Considering.')).toBe('Considering.')

    // The first text block is still the first one, whatever thinking did.
    breaks.startBlock('text')
    expect(breaks.delta('text', 'Here goes.')).toBe('Here goes.')

    breaks.startBlock('thinking')
    expect(breaks.delta('thinking', 'More.')).toBe('\n\nMore.')
  })

  it('ignores blocks that are neither text nor thinking', () => {
    const breaks = paragraphBreaks()
    breaks.delta('text', 'Reading the file.')
    breaks.startBlock('tool_use')
    expect(breaks.delta('text', ' Still the same block.')).toBe(' Still the same block.')
  })
})
