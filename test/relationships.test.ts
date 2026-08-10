import { describe, expect, it } from 'vitest'
import { extractRelationships } from '../server/utils/relationships'

type Agents = Parameters<typeof extractRelationships>[0]
type Commands = Parameters<typeof extractRelationships>[1]
type Skills = Parameters<typeof extractRelationships>[2]
type Plugins = Parameters<typeof extractRelationships>[3]

function rel(
  agents: Agents = [],
  commands: Commands = [],
  skills: Skills = [],
  plugins: Plugins = [],
) {
  return extractRelationships(agents, commands, skills, plugins)
}

describe('extractRelationships', () => {
  it('returns nothing when everything is empty', () => {
    expect(rel()).toEqual([])
  })

  // ── Command → Agent via frontmatter ──

  it('links a command to an agent via its frontmatter agent field', () => {
    const agents: Agents = [{ slug: 'reviewer', body: '' }]
    const commands: Commands = [{ slug: 'review', body: '', frontmatter: { agent: 'reviewer' } }]
    const result = rel(agents, commands)

    expect(result).toContainEqual(expect.objectContaining({
      sourceType: 'command',
      sourceSlug: 'review',
      targetType: 'agent',
      targetSlug: 'reviewer',
      type: 'agent-frontmatter',
    }))
  })

  it('ignores a frontmatter agent that does not exist', () => {
    const commands: Commands = [{ slug: 'review', body: '', frontmatter: { agent: 'ghost' } }]
    expect(rel([], commands)).toEqual([])
  })

  // ── Command → Agent via subagent_type ──

  it('finds subagent_type references in command bodies', () => {
    const agents: Agents = [{ slug: 'test-runner', body: '' }]
    const commands: Commands = [{
      slug: 'test',
      body: 'Use subagent_type: "test-runner" for this.',
      frontmatter: {},
    }]
    const result = rel(agents, commands)

    expect(result).toContainEqual(expect.objectContaining({
      type: 'spawns',
      targetSlug: 'test-runner',
    }))
  })

  // ── Command → Agent via spawn/dispatch patterns ──

  it('finds spawn/dispatch patterns in command bodies', () => {
    const agents: Agents = [{ slug: 'code-planner', body: '' }]
    const commands: Commands = [{
      slug: 'plan',
      body: 'Dispatches to the code-planner for heavy lifting.',
      frontmatter: {},
    }]
    const result = rel(agents, commands)

    expect(result).toContainEqual(expect.objectContaining({
      type: 'spawns',
      targetSlug: 'code-planner',
    }))
  })

  // ── Command → Agent via hyphenated name mention ──

  it('finds hyphenated agent name mentions in command bodies', () => {
    const agents: Agents = [{ slug: 'log-detective', body: '' }]
    const commands: Commands = [{
      slug: 'logs',
      body: 'The log-detective handles this.',
      frontmatter: {},
    }]
    const result = rel(agents, commands)

    expect(result).toContainEqual(expect.objectContaining({
      type: 'spawns',
      targetSlug: 'log-detective',
    }))
  })

  it('skips short or non-hyphenated names to avoid false positives', () => {
    const agents: Agents = [{ slug: 'plan', body: '' }, { slug: 'ab-cd', body: '' }]
    const commands: Commands = [{
      slug: 'cmd',
      body: 'We plan to ab-cd this.',
      frontmatter: {},
    }]
    // 'plan' has no hyphen, 'ab-cd' is < 6 chars — both skipped
    expect(rel(agents, commands)).toEqual([])
  })

  // ── Agent → Command via invocation ──

  it('links agents back to commands they invoke', () => {
    const agents: Agents = [{ slug: 'helper', body: 'Run /hd:debug to investigate.' }]
    const commands: Commands = [{
      slug: 'hd--debug',
      body: '',
      frontmatter: { name: 'hd:debug' },
      invocation: '/hd:debug',
    }]
    const result = rel(agents, commands)

    expect(result).toContainEqual(expect.objectContaining({
      sourceType: 'agent',
      sourceSlug: 'helper',
      targetType: 'command',
      targetSlug: 'hd--debug',
      type: 'spawned-by',
    }))
  })

  // ── Skill → Agent ──

  it('links a skill to an agent via frontmatter', () => {
    const agents: Agents = [{ slug: 'reviewer', body: '' }]
    const skills: Skills = [{
      slug: 'review-skill',
      body: '',
      frontmatter: { agent: 'reviewer' },
    }]
    const result = rel(agents, [], skills)

    expect(result).toContainEqual(expect.objectContaining({
      sourceType: 'skill',
      sourceSlug: 'review-skill',
      targetType: 'agent',
      targetSlug: 'reviewer',
      type: 'agent-frontmatter',
    }))
  })

  it('links a skill to an agent via hyphenated name in body', () => {
    const agents: Agents = [{ slug: 'pr-doctor', body: '' }]
    const skills: Skills = [{
      slug: 'review',
      body: 'Dispatches work to the pr-doctor.',
      frontmatter: {},
    }]
    const result = rel(agents, [], skills)

    expect(result).toContainEqual(expect.objectContaining({
      sourceType: 'skill',
      targetSlug: 'pr-doctor',
      type: 'spawns',
    }))
  })

  // ── Plugin ownership ──

  it('links a plugin to its skills, agents, and commands', () => {
    const agents: Agents = [{ slug: 'bot', body: '' }]
    const commands: Commands = [{ slug: 'run', body: '', frontmatter: {}, invocation: '/run' }]
    const skills: Skills = [{ slug: 'scan', body: '', frontmatter: {} }]
    const plugins: Plugins = [{
      id: 'my-plugin',
      name: 'My Plugin',
      skills: ['scan'],
      agents: ['bot'],
      commands: ['/run'],
    }]
    const result = rel(agents, commands, skills, plugins)

    expect(result).toContainEqual(expect.objectContaining({
      sourceType: 'plugin', sourceSlug: 'my-plugin',
      targetType: 'skill', targetSlug: 'scan',
    }))
    expect(result).toContainEqual(expect.objectContaining({
      sourceType: 'plugin', sourceSlug: 'my-plugin',
      targetType: 'agent', targetSlug: 'bot',
    }))
    expect(result).toContainEqual(expect.objectContaining({
      sourceType: 'plugin', sourceSlug: 'my-plugin',
      targetType: 'command', targetSlug: 'run',
    }))
  })

  // ── Deduplication ──

  it('deduplicates identical relationships', () => {
    const agents: Agents = [{ slug: 'log-detective', body: '' }]
    const commands: Commands = [{
      slug: 'logs',
      body: 'Spawns the log-detective. The log-detective handles it.',
      frontmatter: {},
    }]
    const result = rel(agents, commands)

    // The hyphenated name match and the spawn pattern should both find it,
    // but only one relationship should be emitted.
    const matches = result.filter(r => r.targetSlug === 'log-detective')
    expect(matches).toHaveLength(1)
  })
})
