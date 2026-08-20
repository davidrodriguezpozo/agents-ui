import { describe, expect, it } from 'vitest'
import { BINDINGS, binding, bindingsFor, hint, needsConfirm } from '../keymap'

describe('the keymap', () => {
  it('has one entry per id', () => {
    const ids = BINDINGS.map(item => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not bind the same key twice on one surface', () => {
    for (const surface of new Set(BINDINGS.map(item => item.surface))) {
      const keys = bindingsFor(surface).map(item => item.keys)
      expect(new Set(keys).size, `${surface} has a duplicate key`).toBe(keys.length)
    }
  })

  it('never binds a bare `q` or `?` outside the global surface', () => {
    // Both are handled once, in `App`, and a view claiming them would only be
    // documenting a key it cannot receive.
    for (const item of BINDINGS) {
      if (item.surface === 'global') continue
      expect(item.keys).not.toBe('q')
      expect(item.keys).not.toBe('?')
    }
  })

  it('asks first for everything that spends money or writes somewhere else', () => {
    expect(needsConfirm('land.merge')).toBe(true)
    expect(needsConfirm('session.merge')).toBe(true)
    expect(needsConfirm('session.pr')).toBe(true)
    expect(needsConfirm('session.close')).toBe(true)
    expect(needsConfirm('daily.run')).toBe(true)
    expect(needsConfirm('inbox.look')).toBe(true)
    // Reading is not one of them.
    expect(needsConfirm('open')).toBe(false)
    expect(needsConfirm('refresh')).toBe(false)
  })

  it('throws on a hint asking for a key that does not exist', () => {
    // The whole point of the table: a footer promising a key nobody implemented
    // fails here rather than printing a lie.
    expect(() => binding('session.teleport')).toThrow(/No such binding/)
  })

  it('prints a footer as keys and short labels', () => {
    // The long half of a label is for the help page; a footer takes the first
    // clause, so `Have it fix its own failing checks` does not eat the line.
    // The short form when there is one, the first clause of the sentence when
    // there is not.
    expect(hint(['session.repair'])).toBe('f fix checks')
    expect(hint(['session.allow'])).toBe('y a allow once')
    expect(hint(['open', 'work.new', 'work.tab'])).toBe('⏎ open   n new   tab history')
  })
})
