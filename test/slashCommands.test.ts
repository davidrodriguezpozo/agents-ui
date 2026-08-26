import { describe, expect, it } from 'vitest'
import { offersCommands, slashQuery } from '../app/utils/slashCommands'

describe('offersCommands', () => {
  it('offers the list on a bare slash', () => {
    expect(offersCommands('/')).toBe(true)
  })

  it('offers it while the name is being typed', () => {
    expect(offersCommands('/code')).toBe(true)
    expect(offersCommands('/code-review')).toBe(true)
  })

  it('says nothing about ordinary text', () => {
    expect(offersCommands('')).toBe(false)
    expect(offersCommands('Fix the flaky upload test')).toBe(false)
  })

  it('stops once the command has an argument', () => {
    // The list hovering over the box for the rest of a long instruction is in
    // the way — past the name you are writing arguments, not choosing.
    expect(offersCommands('/code-review app/pages/work.vue')).toBe(false)
    expect(offersCommands('/code-review ')).toBe(false)
  })

  it('is not fooled by a slash inside a message', () => {
    expect(offersCommands('look at app/utils/keys.ts')).toBe(false)
  })
})

describe('slashQuery', () => {
  it('is what has been typed after the slash', () => {
    expect(slashQuery('/code')).toBe('code')
    expect(slashQuery('/haddock-tech:review')).toBe('haddock-tech:review')
  })

  it('is empty on a bare slash, which lists everything', () => {
    expect(slashQuery('/')).toBe('')
  })

  it('is empty when the box is not on a slash-word at all', () => {
    expect(slashQuery('')).toBe('')
    expect(slashQuery('Fix the flaky upload test')).toBe('')
    // Past the name the query would be meaningless; the list is closed by then.
    expect(slashQuery('/code-review app/pages/work.vue')).toBe('')
  })
})
