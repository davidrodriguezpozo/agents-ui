import { describe, expect, it } from 'vitest'
import { BINDINGS, binding, bindingsFor, createKeymap, hint, needsConfirm, pressMatches } from '../keymap'

describe('the keymap', () => {
  it('has one entry per id', () => {
    const ids = BINDINGS.map(item => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not bind the same key twice on one surface', () => {
    for (const surface of new Set(BINDINGS.map(item => item.surface))) {
      const pressed = bindingsFor(surface).flatMap(item => item.press ?? [])
      expect(new Set(pressed).size, `${surface} has a duplicate key`).toBe(pressed.length)
    }
  })

  it('never binds a bare `q` or `?` outside the global surface', () => {
    // Both are handled once, in `App`, and a surface claiming them would only be
    // documenting a key it cannot receive.
    for (const item of BINDINGS) {
      if (item.surface === 'global') continue
      expect(item.press ?? [], item.id).not.toContain('q')
      expect(item.press ?? [], item.id).not.toContain('?')
    }
  })

  it('asks first for everything that spends money or writes somewhere else', () => {
    expect(needsConfirm('rail.merge')).toBe(true)
    expect(needsConfirm('rail.run')).toBe(true)
    expect(needsConfirm('pull.merge')).toBe(true)
    expect(needsConfirm('ritual.run')).toBe(true)
    expect(needsConfirm('inbox.look')).toBe(true)
    expect(needsConfirm('session.merge')).toBe(true)
    expect(needsConfirm('session.pr')).toBe(true)
    expect(needsConfirm('session.close')).toBe(true)
    // Reading is not one of them.
    expect(needsConfirm('rail.open')).toBe(false)
    expect(needsConfirm('refresh')).toBe(false)
  })

  it('throws on a hint asking for a key that does not exist', () => {
    // The whole point of the table: a footer promising a key nobody implemented
    // fails here rather than printing a lie.
    expect(() => binding('session.teleport')).toThrow(/No such binding/)
  })

  it('prints a footer as keys and short labels', () => {
    expect(hint(['rail.open', 'rail.new', 'queue'])).toBe('⏎ open   n new   Y answer all')
    // The long half of a label is for the help page; a footer takes the short
    // form, so `Have it fix its own failing checks` does not eat the line.
    expect(hint(['session.repair'])).toBe('f fix checks')
  })
})

describe('pressMatches', () => {
  it('tells a letter from the same letter with control held', () => {
    expect(pressMatches('d', 'd', {})).toBe(true)
    expect(pressMatches('d', 'd', { ctrl: true })).toBe(false)
    expect(pressMatches('ctrl+d', 'd', { ctrl: true })).toBe(true)
    expect(pressMatches('ctrl+d', 'd', {})).toBe(false)
  })

  it('is case sensitive, because `r` and `R` are different keys', () => {
    expect(pressMatches('R', 'R', {})).toBe(true)
    expect(pressMatches('R', 'r', {})).toBe(false)
    expect(pressMatches('r', 'R', {})).toBe(false)
  })

  it('knows the keys that have names rather than letters', () => {
    expect(pressMatches('esc', '', { escape: true })).toBe(true)
    expect(pressMatches('enter', '', { return: true })).toBe(true)
    expect(pressMatches('tab', '', { tab: true })).toBe(true)
    expect(pressMatches('tab', '', { tab: true, shift: true })).toBe(false)
    expect(pressMatches('shift+tab', '', { tab: true, shift: true })).toBe(true)
    expect(pressMatches('enter', 'x', {})).toBe(false)
  })
})

describe('createKeymap', () => {
  it('takes a person at their word about their own keys', () => {
    const keys = createKeymap({ 'session.checks': 'C' })
    expect(keys.matches('session.checks', 'C', {})).toBe(true)
    expect(keys.matches('session.checks', 'c', {})).toBe(false)
    // And the printed form moves with it, because the help page and the footers
    // read the same binding the handler does.
    expect(keys.keysOf('session.checks')).toBe('C')
    expect(keys.hint(['session.checks'])).toBe('C checks')
  })

  it('prints a control override the way the built-in ones are printed', () => {
    expect(createKeymap({ refresh: 'ctrl+r' }).keysOf('refresh')).toBe('⌃r')
  })

  it('leaves everything it was not asked about alone', () => {
    const keys = createKeymap({ 'session.checks': 'C' })
    expect(keys.matches('session.diff', 'd', {})).toBe(true)
    expect(keys.keysOf('quit')).toBe('q')
  })
})
