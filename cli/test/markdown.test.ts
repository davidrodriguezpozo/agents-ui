import { describe, expect, it } from 'vitest'
import { inline, markdownLines, wrap } from '../markdown'

const plain = (lines: { text: string }[]) => lines.map(line => line.text)

describe('inline', () => {
  it('takes the punctuation out and keeps the emphasis', () => {
    expect(inline('a **bold** word')).toEqual([
      { text: 'a ' },
      { text: 'bold', bold: true },
      { text: ' word' },
    ])
  })

  it('colours code and leaves what is inside it alone', () => {
    expect(inline('run `bun **test**` now')).toEqual([
      { text: 'run ' },
      { text: 'bun **test**', tone: 'green' },
      { text: ' now' },
    ])
  })

  it('keeps a link as its text, with the target only when it adds something', () => {
    expect(inline('see [the guide](https://x.dev/guide)')).toEqual([
      { text: 'see ' },
      { text: 'the guide', underline: true },
      { text: ' (https://x.dev/guide)', tone: 'gray' },
    ])
    // A link whose text already is the URL does not get it twice.
    expect(inline('[https://x.dev](https://x.dev)')).toEqual([
      { text: 'https://x.dev', underline: true },
    ])
  })

  it('leaves text with no markup in it exactly as it was', () => {
    expect(inline('nothing to do here')).toEqual([{ text: 'nothing to do here' }])
    expect(inline('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }])
  })
})

describe('markdownLines', () => {
  it('draws a heading in bold, without its hashes', () => {
    const [line] = markdownLines('## The double-inset fix', 60)
    expect(line!.text).toBe('The double-inset fix')
    expect(line!.spans[0]).toMatchObject({ bold: true, underline: true })
  })

  it('turns a list into bullets that line up under themselves', () => {
    const lines = markdownLines('- one thing that is quite long indeed here\n- two', 24)
    expect(plain(lines)[0]).toBe('• one thing that is')
    // The continuation is indented to the text, not to the bullet.
    expect(plain(lines)[1]).toBe('  quite long indeed here')
    expect(plain(lines).at(-1)).toBe('• two')
  })

  it('keeps a fenced block verbatim, and never re-wraps it', () => {
    const lines = markdownLines('```ts\nconst x = veryLongIdentifierName(1, 2, 3)\n```', 20)
    expect(plain(lines)).toEqual(['  ts', '  const x = veryLong'])
    expect(lines[1]!.spans[0]!.tone).toBe('green')
  })

  it('does not read markup inside a fence', () => {
    const lines = markdownLines('```\n## not a heading\n```', 40)
    expect(plain(lines)).toEqual(['  ## not a heading'])
  })

  it('draws a rule, quotes a quote, and keeps blank lines', () => {
    expect(markdownLines('---', 10)[0]!.text).toBe('──────────')
    expect(markdownLines('> mind this', 40)[0]!.text).toBe('│ mind this')
    expect(plain(markdownLines('a\n\nb', 10))).toEqual(['a', '', 'b'])
  })

  it('wraps a paragraph at the width, styling intact across the break', () => {
    const lines = markdownLines('the **flaky terminal test** fails one run in five', 20)
    expect(lines.every(line => line.text.length <= 20)).toBe(true)
    expect(lines.flatMap(line => line.spans).some(span => span.bold)).toBe(true)
  })
})

describe('wrap', () => {
  it('breaks a word longer than the pane rather than overflowing', () => {
    const lines = wrap([{ text: 'supercalifragilistic' }], 8)
    expect(plain(lines)).toEqual(['supercal', 'ifragili', 'stic'])
  })

  it('indents continuations with what it was given', () => {
    const lines = wrap([{ text: 'one two three four' }], 9, '- ', '  ')
    expect(plain(lines)[0]!.startsWith('- ')).toBe(true)
    expect(plain(lines)[1]!.startsWith('  ')).toBe(true)
  })
})
