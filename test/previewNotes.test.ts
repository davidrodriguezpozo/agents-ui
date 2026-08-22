import { describe, expect, it } from 'vitest'
import { composePointNotes, type PointNote } from '../app/utils/previewNotes'
import { selectorFor, type SelectorElement } from '../server/utils/previewSelector'

/**
 * The instruction is the whole product of pointing at something: everything
 * before it is a click, and everything after it is an agent reading a sentence.
 * So what is checked here is that the sentence names the element, says what it
 * looked like, and repeats what the person typed without decoration.
 */

let seq = 0

function note(over: Partial<PointNote> = {}): PointNote {
  seq++
  return {
    id: `n${seq}`,
    selector: 'button.btn',
    tag: 'button',
    text: 'Run it',
    path: '/sessions/abc',
    box: { x: 412, y: 218, width: 96, height: 32 },
    body: 'wrong colour',
    at: 1_700_000_000_000 + seq,
    ...over,
  }
}

describe('composing what was pointed at', () => {
  it('names the element, describes it, and says what is wrong', () => {
    const { instruction } = composePointNotes([note()])

    expect(instruction).toContain('`button.btn` on /sessions/abc')
    expect(instruction).toContain('A <button> that reads "Run it", 96×32 at (412, 218).')
    expect(instruction).toContain('wrong colour')
  })

  it('tells the agent to find it in the source rather than trusting the selector', () => {
    expect(composePointNotes([note()]).instruction).toMatch(/find it in the source/)
  })

  it('leaves room to disagree, the same as a diff note does', () => {
    expect(composePointNotes([note()]).instruction).toMatch(/disagree/)
    expect(composePointNotes([note(), note()]).instruction).toMatch(/disagree/)
  })

  it('keeps them in the order they were pointed at', () => {
    const { instruction, sent } = composePointNotes([
      note({ selector: 'footer p', body: 'too small' }),
      note({ selector: 'header h1', body: 'too big' }),
    ])

    expect(sent.map(n => n.selector)).toEqual(['footer p', 'header h1'])
    expect(instruction.indexOf('footer p')).toBeLessThan(instruction.indexOf('header h1'))
  })

  it('counts them in the framing', () => {
    expect(composePointNotes([note(), note(), note()]).instruction)
      .toContain('I pointed at 3 elements')
    expect(composePointNotes([note()]).instruction).toContain('I pointed at one element')
  })

  it('says nothing about text an element does not have', () => {
    const { instruction } = composePointNotes([note({ text: '', tag: 'img' })])

    expect(instruction).not.toContain('reads')
    expect(instruction).toContain('A <img>, 96×32 at (412, 218).')
  })

  it('omits a box with no size, which describes nothing', () => {
    const { instruction } = composePointNotes([
      note({ box: { x: 0, y: 0, width: 0, height: 0 }, text: 'Hidden' }),
    ])

    expect(instruction).toContain('A <button> that reads "Hidden".')
    expect(instruction).not.toContain('at (0, 0)')
  })

  it('cuts a wall of text down to a label', () => {
    const { instruction } = composePointNotes([note({ text: 'x'.repeat(400) })])

    expect(instruction).toContain(`${'x'.repeat(120)}…`)
    expect(instruction).not.toContain('x'.repeat(140))
  })

  it('collapses whitespace, because a selector list is one line', () => {
    const { instruction } = composePointNotes([note({ text: 'Save\n   and close' })])

    expect(instruction).toContain('reads "Save and close"')
  })

  it('skips a note nobody wrote anything in', () => {
    const { instruction, sent } = composePointNotes([note({ body: '   ' }), note({ body: 'fix it' })])

    expect(sent).toHaveLength(1)
    expect(instruction).toContain('I pointed at one element')
  })

  it('has nothing to send when there is nothing to say', () => {
    expect(composePointNotes([])).toEqual({ instruction: '', sent: [] })
    expect(composePointNotes([note({ body: '' })]).instruction).toBe('')
  })

  it('drops a note whose element was never named', () => {
    expect(composePointNotes([note({ selector: '' })]).sent).toEqual([])
  })
})

/**
 * The brief's by-hand step, as far as a session with no browser can take it:
 * point at a button in a page, write "wrong colour", and read the turn.
 *
 * The click and the highlight are the half a browser has to do. This is the
 * other half — the selector the picker would compute for that element, carried
 * through the composer into the instruction that gets sent.
 */
describe('pointing at a button and saying what is wrong with it', () => {
  it('produces a turn that is actionable without the screenshot', () => {
    const page: SelectorElement & { children: SelectorElement[] } = {
      tagName: 'BODY', id: '', className: '', parentElement: null, children: [],
    }
    const bar: SelectorElement & { children: SelectorElement[] } = {
      tagName: 'DIV', id: '', className: 'toolbar', parentElement: page, children: [],
    }
    const button: SelectorElement = {
      tagName: 'BUTTON', id: '', className: 'btn primary', parentElement: bar, children: [],
    }
    page.children.push(bar)
    bar.children.push(button)

    const selector = selectorFor(button, sel => (sel === 'button.btn.primary' ? 1 : 2))
    const { instruction } = composePointNotes([{
      id: 'one',
      selector,
      tag: 'button',
      text: 'Run it',
      path: '/sessions/abc',
      box: { x: 412, y: 218, width: 96, height: 32 },
      body: 'wrong colour',
      at: 1_700_000_000_000,
    }])

    expect(selector).toBe('button.btn.primary')
    expect(instruction).toBe(
      'I pointed at one element in the running preview — find it in the source and fix it. '
      + 'If you disagree, say so instead of changing it.\n'
      + '\n'
      + '`button.btn.primary` on /sessions/abc\n'
      + 'A <button> that reads "Run it", 96×32 at (412, 218).\n'
      + 'wrong colour',
    )
  })
})
