import { describe, expect, it } from 'vitest'
import { firstJsonObject, parseJsonFromReply } from '../server/utils/extractJson'

/**
 * Reading a model's JSON back, however it chose to wrap it.
 *
 * The shapes below are all real ones: bare, fenced, fenced-with-a-paragraph-of
 * -commentary-after-it. The last is what pasted a whole JSON blob into an
 * agent's instructions before this existed.
 */

describe('parseJsonFromReply', () => {
  it('reads plain JSON', () => {
    expect(parseJsonFromReply('{"a":1}')).toEqual({ a: 1 })
  })

  it('reads JSON in a fenced block', () => {
    expect(parseJsonFromReply('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJsonFromReply('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('reads JSON with commentary after it — the case that caused this', () => {
    const reply = `\`\`\`json
{"suggestions":[{"type":"tone","description":"d","original":"o","suggested":"s"}],"improvedInstructions":"Be brief."}
\`\`\`

**Key takeaways:** Your current instruction leaves everything to interpretation.`

    expect(parseJsonFromReply<any>(reply)?.improvedInstructions).toBe('Be brief.')
  })

  it('reads JSON with a preamble before it', () => {
    expect(parseJsonFromReply('Sure, here you go:\n\n{"a":1}')).toEqual({ a: 1 })
  })

  it('is not fooled by a brace inside a string', () => {
    const reply = '{"text":"a } that is not the end","done":true}'
    expect(parseJsonFromReply(reply)).toEqual({ text: 'a } that is not the end', done: true })
  })

  it('is not fooled by an escaped quote before a brace', () => {
    const reply = String.raw`{"text":"quote \" then } brace","done":true}`
    expect(parseJsonFromReply<any>(reply)?.done).toBe(true)
  })

  it('returns null for a reply with no object in it, rather than guessing', () => {
    expect(parseJsonFromReply('I would rather not.')).toBeNull()
    expect(parseJsonFromReply('')).toBeNull()
    expect(parseJsonFromReply('   ')).toBeNull()
  })

  it('returns null for an object it cannot parse, rather than half of one', () => {
    expect(parseJsonFromReply('{"a": }')).toBeNull()
  })

  it('does not accept a bare array or scalar as an object', () => {
    expect(parseJsonFromReply('[1,2,3]')).toEqual([1, 2, 3])
    expect(parseJsonFromReply('42')).toBeNull()
    expect(parseJsonFromReply('"hello"')).toBeNull()
  })
})

describe('firstJsonObject', () => {
  it('stops at the matching brace, not the first one it sees', () => {
    expect(firstJsonObject('{"a":{"b":1}} trailing')).toBe('{"a":{"b":1}}')
  })

  it('returns null when nothing closes', () => {
    expect(firstJsonObject('{"a":1')).toBeNull()
    expect(firstJsonObject('no braces here')).toBeNull()
  })
})
