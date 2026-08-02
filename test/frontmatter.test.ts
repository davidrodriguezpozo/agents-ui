import { describe, expect, it } from 'vitest'
import { parseFrontmatter, serializeFrontmatter } from '../server/utils/frontmatter'

/**
 * Everything the app reads comes off someone's disk, so parsing has to survive
 * files it did not write — hand-edited, half-saved, or from a plugin author
 * with different habits.
 */
describe('parseFrontmatter', () => {
  it('reads a well-formed file', () => {
    const { frontmatter, body } = parseFrontmatter<{ name: string; description: string }>(
      '---\nname: reviewer\ndescription: Reviews code\n---\n\nDo the review.\n'
    )
    expect(frontmatter.name).toBe('reviewer')
    expect(frontmatter.description).toBe('Reviews code')
    expect(body).toBe('Do the review.\n')
  })

  it('treats a file with no frontmatter as all body', () => {
    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>('Just instructions.')
    expect(frontmatter).toEqual({})
    expect(body).toBe('Just instructions.')
  })

  it('falls back to key-value parsing when the YAML is malformed', () => {
    // An unclosed quote makes this invalid YAML, but the intent is recoverable.
    const { frontmatter } = parseFrontmatter<{ name?: string }>(
      '---\nname: "unclosed\ndescription: still useful\n---\nbody'
    )
    expect(frontmatter.name).toBeDefined()
  })

  it('does not throw on an empty file', () => {
    expect(() => parseFrontmatter('')).not.toThrow()
    expect(parseFrontmatter('').body).toBe('')
  })

  it('does not throw on frontmatter delimiters with nothing between them', () => {
    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>('---\n\n---\nbody')
    expect(body).toBe('body')
    expect(frontmatter).toBeDefined()
  })

  it('keeps a body that itself contains --- lines', () => {
    const { body } = parseFrontmatter<{ name: string }>(
      '---\nname: x\n---\n\nIntro\n\n---\n\nA horizontal rule above.\n'
    )
    expect(body).toContain('horizontal rule')
    expect(body).toContain('---')
  })

  it('preserves list values such as tools', () => {
    const { frontmatter } = parseFrontmatter<{ tools: string[] }>(
      '---\nname: x\ntools:\n  - Read\n  - Grep\n---\nbody'
    )
    expect(frontmatter.tools).toEqual(['Read', 'Grep'])
  })
})

describe('serializeFrontmatter', () => {
  it('round-trips through the parser', () => {
    const original = { name: 'reviewer', description: 'Reviews code', tools: ['Read', 'Grep'] }
    const { frontmatter, body } = parseFrontmatter<typeof original>(
      serializeFrontmatter(original, 'Do the review.')
    )
    expect(frontmatter).toEqual(original)
    expect(body.trim()).toBe('Do the review.')
  })

  it('survives a description containing colons and quotes', () => {
    // Descriptions are prose written by people; YAML cares about both.
    const original = { name: 'x', description: 'Use when: the user says "go"' }
    const { frontmatter } = parseFrontmatter<typeof original>(serializeFrontmatter(original, 'body'))
    expect(frontmatter.description).toBe(original.description)
  })

  it('survives a multi-line description', () => {
    const original = { name: 'x', description: 'First line.\nSecond line.' }
    const { frontmatter } = parseFrontmatter<typeof original>(serializeFrontmatter(original, 'body'))
    expect(frontmatter.description).toBe(original.description)
  })

  it('keeps an empty body from collapsing the document', () => {
    const { frontmatter, body } = parseFrontmatter<{ name: string }>(
      serializeFrontmatter({ name: 'x' }, '')
    )
    expect(frontmatter.name).toBe('x')
    expect(body.trim()).toBe('')
  })
})
