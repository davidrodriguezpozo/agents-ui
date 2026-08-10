import { describe, expect, it } from 'vitest'
import {
  formatAllowedTools,
  mergeSkillFrontmatter,
  normalizeSkillFrontmatter,
  parseAllowedTools,
} from '../app/utils/skillFrontmatter'
import { parseFrontmatter, serializeFrontmatter } from '../server/utils/frontmatter'
import type { SkillFrontmatter } from '../app/types'

/**
 * The editor used to rebuild frontmatter out of the four fields it displays,
 * which meant opening somebody's skill, fixing a typo in its description, and
 * pressing Save deleted every other key in the file. `allowed-tools` was the
 * expensive one: the skill stayed valid, quietly gained access to every tool,
 * and nothing on screen ever said so.
 *
 * So the property under test is round-tripping. Anything read off disk that the
 * form has no field for has to come back out unchanged.
 */
describe('mergeSkillFrontmatter', () => {
  it('keeps keys the editor has no field for', () => {
    const original: SkillFrontmatter = {
      name: 'code-review',
      description: 'Reviews code',
      license: 'MIT',
      metadata: { author: 'someone' },
    }

    const merged = mergeSkillFrontmatter(original, {
      name: 'code-review',
      description: 'Reviews code carefully',
    })

    expect(merged.license).toBe('MIT')
    expect(merged.metadata).toEqual({ author: 'someone' })
    expect(merged.description).toBe('Reviews code carefully')
  })

  it('keeps allowed-tools when the form never touched it', () => {
    // The regression that started this: a description edit stripped the allowlist.
    const original: SkillFrontmatter = {
      name: 'x',
      description: 'old',
      'allowed-tools': ['Read', 'Grep'],
    }

    const merged = mergeSkillFrontmatter(original, { name: 'x', description: 'new' })

    expect(merged['allowed-tools']).toEqual(['Read', 'Grep'])
  })

  it('replaces allowed-tools when the form did touch it', () => {
    const merged = mergeSkillFrontmatter(
      { name: 'x', description: 'd', 'allowed-tools': ['Read'] },
      { name: 'x', description: 'd', 'allowed-tools': ['Bash', 'Write'] },
    )

    expect(merged['allowed-tools']).toEqual(['Bash', 'Write'])
  })

  it('drops an optional key that came back empty', () => {
    // Clearing the Agent field should remove the key, not write `agent: ""`.
    const merged = mergeSkillFrontmatter(
      { name: 'x', description: 'd', agent: 'reviewer' },
      { name: 'x', description: 'd', agent: '' },
    )

    expect('agent' in merged).toBe(false)
  })

  it('drops an emptied tool list rather than writing an empty allowlist', () => {
    // `allowed-tools: []` is not "no restriction" — it is "no tools".
    const merged = mergeSkillFrontmatter(
      { name: 'x', description: 'd', 'allowed-tools': ['Read'] },
      { name: 'x', description: 'd', 'allowed-tools': [] },
    )

    expect('allowed-tools' in merged).toBe(false)
  })

  it('trims what people type', () => {
    const merged = mergeSkillFrontmatter(undefined, { name: '  x  ', description: ' spaced ' })

    expect(merged.name).toBe('x')
    expect(merged.description).toBe('spaced')
  })

  it('works with nothing to merge onto, which is the create case', () => {
    const merged = mergeSkillFrontmatter(undefined, { name: 'fresh', description: 'new skill' })

    expect(merged).toEqual({ name: 'fresh', description: 'new skill' })
  })

  it('leads with name and description whatever order the file had', () => {
    // A one-word edit should produce a one-line diff, not a reshuffled file.
    const merged = mergeSkillFrontmatter(
      { license: 'MIT', description: 'd', name: 'x' } as SkillFrontmatter,
      { name: 'x', description: 'd2' },
    )

    expect(Object.keys(merged)).toEqual(['name', 'description', 'license'])
  })

  it('does not mutate what it was given', () => {
    const original: SkillFrontmatter = { name: 'x', description: 'd', license: 'MIT' }
    mergeSkillFrontmatter(original, { name: 'y', description: 'e' })

    expect(original.name).toBe('x')
  })

  it('survives the whole trip through a file on disk', () => {
    const raw = [
      '---',
      'name: code-review',
      'description: Reviews code',
      'allowed-tools:',
      '  - Read',
      '  - Grep',
      'license: MIT',
      '---',
      '',
      'Review it.',
    ].join('\n')

    const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)
    const merged = mergeSkillFrontmatter(frontmatter, {
      ...frontmatter,
      description: 'Reviews code carefully',
    })
    const written = serializeFrontmatter(merged, body)
    const reread = parseFrontmatter<SkillFrontmatter>(written).frontmatter

    expect(reread['allowed-tools']).toEqual(['Read', 'Grep'])
    expect(reread.license).toBe('MIT')
    expect(reread.description).toBe('Reviews code carefully')
  })
})

describe('normalizeSkillFrontmatter', () => {
  it('matches what a save would write, so nothing reads as dirty on open', () => {
    // A file carrying `agent: ""` would otherwise look modified the instant it
    // opened, because saving drops that key.
    const onDisk: SkillFrontmatter = { name: 'x', description: 'd', agent: '' }

    const normalized = normalizeSkillFrontmatter(onDisk)
    const afterSave = mergeSkillFrontmatter(onDisk, { name: 'x', description: 'd', agent: '' })

    expect(JSON.stringify(normalized)).toBe(JSON.stringify(afterSave))
  })

  it('leaves a file that is already clean alone', () => {
    const onDisk: SkillFrontmatter = { name: 'x', description: 'd', 'allowed-tools': ['Read'] }
    expect(normalizeSkillFrontmatter(onDisk)).toEqual(onDisk)
  })
})

describe('the allowed-tools field', () => {
  it('reads a list people typed with commas', () => {
    expect(parseAllowedTools('Read, Grep, Bash')).toEqual(['Read', 'Grep', 'Bash'])
  })

  it('accepts newlines too, because people paste', () => {
    expect(parseAllowedTools('Read\nGrep')).toEqual(['Read', 'Grep'])
  })

  it('does not turn a trailing comma into a tool named nothing', () => {
    expect(parseAllowedTools('Read, Grep, ')).toEqual(['Read', 'Grep'])
  })

  it('is empty for an empty field', () => {
    expect(parseAllowedTools('   ')).toEqual([])
  })

  it('shows a list back as text', () => {
    expect(formatAllowedTools(['Read', 'Grep'])).toBe('Read, Grep')
  })

  it('shows a string the file already had as itself', () => {
    // Some authors write `allowed-tools: Read, Grep` on one line. Displaying
    // that as "[object Object]" or blank would look like the key was missing.
    expect(formatAllowedTools('Read, Grep')).toBe('Read, Grep')
  })

  it('is blank when the key is absent', () => {
    expect(formatAllowedTools(undefined)).toBe('')
  })
})
