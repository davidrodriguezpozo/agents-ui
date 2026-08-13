import { describe, it, expect } from 'vitest'
import { groupByOrigin, initiallyCollapsed, filterGroups } from '~/utils/entityGroups'

interface Thing {
  name: string
  scope?: 'user' | 'project'
  source?: 'local' | 'plugin' | 'github'
  pluginId?: string
  pluginName?: string
  description?: string
}

const mine: Thing = { name: 'my-voice', scope: 'user', source: 'local' }
const projects: Thing = { name: 'repo-rule', scope: 'project', source: 'local' }
const posthog = (n: number): Thing[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `posthog-skill-${i}`, source: 'plugin', pluginId: 'posthog', pluginName: 'posthog',
  }))
const slack: Thing = { name: 'block-kit', source: 'plugin', pluginId: 'slack', pluginName: 'slack' }
const imported: Thing = { name: 'from-gh', source: 'github' }

describe('groupByOrigin', () => {
  it('puts your own work first and plugins last', () => {
    const groups = groupByOrigin([slack, imported, projects, mine])
    expect(groups.map(g => g.kind)).toEqual(['user', 'project', 'github', 'plugin'])
  })

  it('gives each plugin its own group, ordered by name', () => {
    const groups = groupByOrigin([slack, ...posthog(2)])
    expect(groups.map(g => g.label)).toEqual(['posthog', 'slack'])
    expect(groups.find(g => g.label === 'posthog')!.items).toHaveLength(2)
  })

  it('carries the plugin id so a group header can link to it', () => {
    const [group] = groupByOrigin([slack])
    expect(group!.pluginId).toBe('slack')
  })

  it('treats a plugin with no id as its own group rather than dropping it', () => {
    const orphan: Thing = { name: 'x', source: 'plugin', pluginName: 'mystery' }
    const groups = groupByOrigin([orphan])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items).toHaveLength(1)
  })

  it('defaults to personal when nothing says otherwise', () => {
    const groups = groupByOrigin<Thing>([{ name: 'bare' }])
    expect(groups[0]!.kind).toBe('user')
  })
})

describe('initiallyCollapsed', () => {
  it('never collapses your own work, however much of it there is', () => {
    const groups = groupByOrigin([mine, projects])
    const state = initiallyCollapsed(groups)
    expect(state.user).toBe(false)
    expect(state.project).toBe(false)
  })

  it('collapses a big plugin group but leaves a small one open', () => {
    // The real case: 199 skills, 137 of them from one plugin, and the single
    // skill you wrote needs to still be visible on arrival.
    const groups = groupByOrigin([mine, ...posthog(137), slack])
    const state = initiallyCollapsed(groups)
    expect(state['plugin:posthog']).toBe(true)
    expect(state['plugin:slack']).toBe(false)
    expect(state.user).toBe(false)
  })
})

describe('filterGroups', () => {
  const groups = groupByOrigin([mine, slack, ...posthog(3)])
  const text = (t: Thing) => [t.name, t.description, t.pluginName]

  it('drops groups that no longer have a match', () => {
    const result = filterGroups(groups, 'block', text)
    expect(result).toHaveLength(1)
    expect(result[0]!.items[0]!.name).toBe('block-kit')
  })

  it('matches on the plugin name too, so searching a plugin finds its items', () => {
    const result = filterGroups(groups, 'posthog', text)
    expect(result).toHaveLength(1)
    expect(result[0]!.items).toHaveLength(3)
  })

  it('returns the groups untouched when there is no query', () => {
    expect(filterGroups(groups, '   ', text)).toBe(groups)
  })

  it('is case insensitive', () => {
    expect(filterGroups(groups, 'BLOCK-KIT', text)).toHaveLength(1)
  })

  it('tolerates items whose searchable fields are missing', () => {
    const sparse = groupByOrigin<Thing>([{ name: 'only-a-name' }])
    expect(filterGroups(sparse, 'nope', text)).toEqual([])
    expect(filterGroups(sparse, 'only', text)).toHaveLength(1)
  })
})

describe('filterGroups with fields that are not strings', () => {
  /**
   * Every field these searches look through comes from YAML frontmatter, so the
   * types describing them are a hope rather than a guarantee. This function is
   * shared by four lists, so hardening it here fixes the same latent crash in
   * all of them.
   */
  const groups = groupByOrigin<Thing & { hint?: unknown }>([
    { name: 'with-list', hint: ['--since YYYY-MM-DD'] },
    { name: 'with-number', hint: 42 },
    { name: 'with-object', hint: { nested: true } },
    { name: 'with-null', hint: null },
  ])
  const text = (t: Thing & { hint?: unknown }) => [t.name, t.hint]

  it('searches inside a list-valued field', () => {
    const result = filterGroups(groups, 'since', text)
    expect(result.flatMap(g => g.items).map(i => i.name)).toEqual(['with-list'])
  })

  it('searches a numeric field by its digits', () => {
    expect(filterGroups(groups, '42', text).flatMap(g => g.items).map(i => i.name)).toEqual(['with-number'])
  })

  it('ignores a field it cannot read rather than throwing', () => {
    expect(() => filterGroups(groups, 'nested', text)).not.toThrow()
    expect(filterGroups(groups, 'nested', text)).toEqual([])
  })

  it('still matches on the fields it can read when a sibling is unreadable', () => {
    expect(filterGroups(groups, 'with-object', text).flatMap(g => g.items)).toHaveLength(1)
  })
})
