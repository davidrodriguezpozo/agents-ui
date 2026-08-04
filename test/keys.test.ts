import { describe, expect, it } from 'vitest'
import { isNewlineKey, isSendKey } from '../app/utils/keys'

/** Enough of a KeyboardEvent for the rule to read. */
function key(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 13,
    ...init,
  } as KeyboardEvent
}

describe('isSendKey', () => {
  it('sends on Enter', () => {
    expect(isSendKey(key({ key: 'Enter' }))).toBe(true)
  })

  it('does not send on Shift+Enter, which is the new line', () => {
    expect(isSendKey(key({ key: 'Enter', shiftKey: true }))).toBe(false)
  })

  it('still sends on Cmd+Enter, so the old habit keeps working', () => {
    expect(isSendKey(key({ key: 'Enter', metaKey: true }))).toBe(true)
  })

  it('ignores every other key', () => {
    expect(isSendKey(key({ key: 'a' }))).toBe(false)
    expect(isSendKey(key({ key: 'Escape' }))).toBe(false)
    expect(isSendKey(key({ key: 'ArrowDown' }))).toBe(false)
  })

  it('does not send while a character is being composed', () => {
    // Enter mid-composition confirms a Japanese, Chinese or Korean candidate.
    // Sending on it would fire off the message and eat the word being typed.
    expect(isSendKey(key({ key: 'Enter', isComposing: true }))).toBe(false)
  })

  it('respects the older composition signal too', () => {
    // Not every browser sets isComposing on every event in the sequence.
    expect(isSendKey(key({ key: 'Enter', keyCode: 229 }))).toBe(false)
  })
})

describe('isNewlineKey', () => {
  it('is Shift+Enter and nothing else', () => {
    expect(isNewlineKey(key({ key: 'Enter', shiftKey: true }))).toBe(true)
    expect(isNewlineKey(key({ key: 'Enter' }))).toBe(false)
    expect(isNewlineKey(key({ key: 'a', shiftKey: true }))).toBe(false)
  })

  it('never agrees with isSendKey', () => {
    // The two must not both be true, or a box would send and break the line.
    for (const shiftKey of [true, false]) {
      const event = key({ key: 'Enter', shiftKey })
      expect(isSendKey(event) && isNewlineKey(event)).toBe(false)
    }
  })
})
