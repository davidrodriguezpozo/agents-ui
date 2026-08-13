import { describe, it, expect } from 'vitest'
import { toCapabilities, facetCounts, searchableText } from '~/utils/capabilities'
import { groupByOrigin, filterGroups } from '~/utils/entityGroups'
import type { Agent, Command, Skill } from '~/types'

const agent = (over: Partial<Agent> = {}): Agent => ({
  slug: 'code-simplifier', filename: 'x.md', body: '', hasMemory: false, filePath: '/x',
  scope: 'user', source: 'local',
  frontmatter: { name: 'code-simplifier', description: 'Simplifies code', model: 'opus' },
  ...over,
} as Agent)

const command = (over: Partial<Command> = {}): Command => ({
  slug: 'defender-pickup', filename: 'x.md', directory: 'defender', body: '', filePath: '/x',
  scope: 'user', source: 'plugin', pluginId: 'hd', pluginName: 'hd',
  invocation: '/defender:pickup',
  frontmatter: { name: 'pickup', description: 'Pick up a ticket', 'argument-hint': '<url>' },
  ...over,
} as Command)

const skill = (over: Partial<Skill> = {}): Skill => ({
  slug: 'block-kit', body: '', filePath: '/x', source: 'plugin', pluginId: 'slack', pluginName: 'slack',
  frontmatter: { name: 'block-kit', description: 'Build Block Kit layouts' },
  ...over,
} as Skill)

describe('toCapabilities', () => {
  it('keys are unique even when two types share a slug', () => {
    // The real collision: many skills are also exposed as slash commands.
    const items = toCapabilities(
      [agent({ slug: 'review' })],
      [command({ slug: 'review' })],
      [skill({ slug: 'review' })],
    )
    const keys = items.map(i => i.key)
    expect(new Set(keys).size).toBe(3)
  })

  it('shows a command by what you type, not by its bare name', () => {
    const [item] = toCapabilities([], [command()], [])
    expect(item!.name).toBe('/defender:pickup')
    expect(item!.mono).toBe(true)
  })

  it('reads a name rather than types it for agents and skills', () => {
    const items = toCapabilities([agent()], [], [skill()])
    expect(items.every(i => !i.mono)).toBe(true)
  })

  it('carries provenance through, so the grouping still works', () => {
    const groups = groupByOrigin(toCapabilities([agent()], [command()], [skill()]))
    expect(groups.map(g => g.label)).toEqual(['Personal', 'hd', 'slack'])
  })

  it('keeps the type-specific facts each row needs', () => {
    const [a] = toCapabilities([agent({ frontmatter: { name: 'a', description: 'd', model: 'opus', tools: ['x', 'y'] } } as Partial<Agent>)], [], [])
    expect(a!.model).toBe('opus')
    expect(a!.toolCount).toBe(2)

    const [c] = toCapabilities([], [command()], [])
    expect(c!.hint).toBe('<url>')

    const [s] = toCapabilities([], [], [skill({ frontmatter: { name: 's', description: 'd', agent: 'reviewer' } } as unknown as Partial<Skill>)])
    expect(s!.boundAgent).toBe('reviewer')
  })
})

describe('frontmatter that is not the shape the type promises', () => {
  /**
   * Found by opening the page, not by these tests — which is the point of
   * writing them down. `argument-hint: [--since YYYY-MM-DD]` is valid authoring
   * and arrives as an array against a type that says `string`. Three of the
   * thirty-seven commands on the machine this was built on are written that way,
   * and `.toLowerCase()` on one of them threw inside a computed, so the list
   * silently stopped filtering instead of failing loudly.
   */
  it('renders a list-valued argument hint as one line', () => {
    const [item] = toCapabilities([], [command({
      frontmatter: { name: 'x', description: 'd', 'argument-hint': ['--since YYYY-MM-DD'] },
    } as unknown as Partial<Command>)], [])
    expect(item!.hint).toBe('--since YYYY-MM-DD')
  })

  it('joins a multi-valued hint rather than printing a comma-separated array', () => {
    const [item] = toCapabilities([], [command({
      frontmatter: { name: 'x', description: 'd', 'argument-hint': ['<url>', '[flags]'] },
    } as unknown as Partial<Command>)], [])
    expect(item!.hint).toBe('<url> [flags]')
  })

  it('survives a skill whose context or agent is a list', () => {
    const [item] = toCapabilities([], [], [skill({
      frontmatter: { name: 's', description: 'd', context: ['a', 'b'], agent: ['reviewer'] },
    } as unknown as Partial<Skill>)])
    expect(item!.hint).toBe('a b')
    expect(item!.boundAgent).toBe('reviewer')
  })

  it('treats an empty list as absent rather than as an empty badge', () => {
    const [item] = toCapabilities([], [command({
      frontmatter: { name: 'x', description: 'd', 'argument-hint': [] },
    } as unknown as Partial<Command>)], [])
    expect(item!.hint).toBeUndefined()
  })

  it('still filters when a searchable field is not a string', () => {
    const items = toCapabilities([], [command({
      slug: 'notes', invocation: '/hd:release-notes',
      frontmatter: { name: 'n', description: 'd', 'argument-hint': ['--since YYYY-MM-DD'] },
    } as unknown as Partial<Command>)], [])
    const groups = filterGroups(groupByOrigin(items), 'since', searchableText)
    expect(groups.flatMap(g => g.items).map(i => i.name)).toEqual(['/hd:release-notes'])
  })
})

describe('facetCounts', () => {
  it('counts each type and the total', () => {
    const counts = facetCounts(toCapabilities([agent()], [command(), command({ slug: 'b' })], [skill()]))
    expect(counts).toEqual({ all: 4, agent: 1, command: 2, skill: 1 })
  })

  it('is all zeroes on an empty library', () => {
    expect(facetCounts([])).toEqual({ all: 0, agent: 0, command: 0, skill: 0 })
  })
})

describe('search across the merged list', () => {
  const items = toCapabilities([agent()], [command()], [skill()])

  it('finds a plugin by name and returns everything it brought', () => {
    const groups = filterGroups(groupByOrigin(items), 'slack', searchableText)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items[0]!.name).toBe('block-kit')
  })

  it('finds a command by the string you would type', () => {
    const groups = filterGroups(groupByOrigin(items), '/defender', searchableText)
    expect(groups.flatMap(g => g.items).map(i => i.type)).toEqual(['command'])
  })

  it('searches descriptions, so you can look for what a thing does', () => {
    const groups = filterGroups(groupByOrigin(items), 'simplifies', searchableText)
    expect(groups.flatMap(g => g.items).map(i => i.name)).toEqual(['code-simplifier'])
  })

  it('crosses types in one query', () => {
    const groups = filterGroups(groupByOrigin(items), 'i', searchableText)
    const types = new Set(groups.flatMap(g => g.items).map(i => i.type))
    expect(types.size).toBeGreaterThan(1)
  })
})
