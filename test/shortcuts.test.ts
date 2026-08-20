import { describe, it, expect } from 'vitest'
import {
  ACTION_SHORTCUTS, EDITOR_SHORTCUTS, JUMP_SHORTCUTS, LIST_SHORTCUTS, PALETTE_SHORTCUTS,
  NAV_SHORTCUTS, chordHint, chordTarget, isBareKey, isTerminalTarget, isTypingTarget, navShortcuts,
} from '~/utils/shortcuts'

describe('the chord table', () => {
  it('gives every destination its own key', () => {
    const keys = NAV_SHORTCUTS.map(item => item.key)
    expect(new Set(keys).size, `duplicate chord: ${keys}`).toBe(keys.length)
  })

  it('does not claim `g`, which is the chord itself', () => {
    expect(NAV_SHORTCUTS.some(item => item.key === 'g')).toBe(false)
  })

  it('binds each single key once', () => {
    // A chord's second key is only read while `g` is armed, so `n` meaning Now
    // after `g` and "start a session" on its own is not a clash. Two rows both
    // claiming a bare `n` would be.
    const singles = ACTION_SHORTCUTS.map(item => item.keys)
    expect(new Set(singles).size, `duplicate key: ${singles}`).toBe(singles.length)
  })

  it('routes a letter to a page', () => {
    expect(chordTarget('w', false)?.to).toBe('/work')
    expect(chordTarget('W', false)?.to).toBe('/work')
    expect(chordTarget('zzz', false)).toBeNull()
  })

  it('reaches everything in the sidebar', () => {
    for (const to of ['/', '/work', '/land', '/schedules', '/library', '/settings', '/wall', '/explore']) {
      expect(NAV_SHORTCUTS.some(item => item.to === to), `no chord reaches ${to}`).toBe(true)
    }
  })
})

describe('simple mode', () => {
  it('does not offer chords to pages the sidebar is hiding', () => {
    expect(chordTarget('r', false)?.to).toBe('/graph')
    expect(chordTarget('r', true)).toBeNull()
    expect(chordTarget('f', true)).toBeNull()
  })

  it('still reaches everything simple mode shows', () => {
    const simple = navShortcuts(true).map(item => item.to)
    for (const to of ['/', '/work', '/land', '/schedules', '/library', '/settings']) {
      expect(simple, `simple mode should keep ${to}`).toContain(to)
    }
  })
})

describe('hints', () => {
  it('prints the two presses as two presses', () => {
    expect(chordHint('/work')).toBe('g w')
  })

  it('says nothing for a page with no chord', () => {
    expect(chordHint('/sessions/abc')).toBeNull()
  })

  it('withholds the hint for a destination this mode hides', () => {
    expect(chordHint('/graph', false)).toBe('g r')
    expect(chordHint('/graph', true)).toBeNull()
  })
})

describe('when a key means a letter', () => {
  const el = (tag: string, props: Record<string, unknown> = {}) => ({
    tagName: tag.toUpperCase(),
    isContentEditable: false,
    getAttribute: () => null,
    ...props,
  }) as unknown as EventTarget

  it('keeps out of every box you can type in', () => {
    expect(isTypingTarget(el('input'))).toBe(true)
    expect(isTypingTarget(el('textarea'))).toBe(true)
    expect(isTypingTarget(el('select'))).toBe(true)
    // xterm's keyboard input and the code editor are both textareas, which is
    // the whole reason this check is on the tag and not on a class list.
  })

  it('keeps out of anything contenteditable, attribute or not', () => {
    expect(isTypingTarget(el('div', { isContentEditable: true }))).toBe(true)
  })

  it('leaves a combobox its arrow keys', () => {
    expect(isTypingTarget(el('div', { getAttribute: (n: string) => n === 'role' ? 'combobox' : null }))).toBe(true)
  })

  it('fires on the page itself', () => {
    expect(isTypingTarget(el('div'))).toBe(false)
    expect(isTypingTarget(el('a'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('modifiers', () => {
  const press = (over: Partial<KeyboardEvent> = {}) =>
    ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over }) as KeyboardEvent

  it('leaves ⌘, ctrl and alt combinations to whoever owns them', () => {
    expect(isBareKey(press())).toBe(true)
    expect(isBareKey(press({ metaKey: true }))).toBe(false)
    expect(isBareKey(press({ ctrlKey: true }))).toBe(false)
    expect(isBareKey(press({ altKey: true }))).toBe(false)
  })

  it('does not count shift, because `?` is one', () => {
    expect(isBareKey(press({ shiftKey: true }))).toBe(true)
  })
})

describe('the terminal keeps its keys', () => {
  const inTerminal = (matches: boolean) => ({
    tagName: 'TEXTAREA',
    isContentEditable: false,
    getAttribute: () => null,
    closest: (selector: string) => (matches && selector === '.xterm' ? {} : null),
  }) as unknown as EventTarget

  it('recognises the shell, so nvim in the dock gets Escape and ⌃d', () => {
    expect(isTerminalTarget(inTerminal(true))).toBe(true)
  })

  it('does not claim every textarea on the page', () => {
    expect(isTerminalTarget(inTerminal(false))).toBe(false)
    expect(isTerminalTarget(null)).toBe(false)
  })
})

describe('the cheatsheet', () => {
  const every = [
    ...ACTION_SHORTCUTS, ...LIST_SHORTCUTS, ...JUMP_SHORTCUTS,
    ...PALETTE_SHORTCUTS, ...EDITOR_SHORTCUTS,
  ]

  it('labels every row it prints', () => {
    for (const row of every) {
      expect(row.keys.length).toBeGreaterThan(0)
      expect(row.label.length).toBeGreaterThan(0)
    }
  })

  it('documents the motions a vim user will reach for first', () => {
    const keys = every.map(row => row.keys)
    for (const motion of ['gg', 'G', '⌃d', '⌃u', 'zz', '⌃o', '⌃i']) {
      expect(keys, `${motion} should be in the cheatsheet`).toContain(motion)
    }
  })

  it('spells Ctrl the way vim does, not the way macOS does', () => {
    // ⌘ is this app's own layer; ⌃ is the one borrowed from the editor. Mixing
    // the glyphs is how somebody ends up pressing ⌘d and bookmarking the page.
    const borrowed = [...LIST_SHORTCUTS, ...JUMP_SHORTCUTS, ...PALETTE_SHORTCUTS]
    expect(borrowed.filter(row => row.keys.includes('⌘'))).toEqual([])
  })
})
