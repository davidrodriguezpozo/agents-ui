import type { Agent, Command, Skill } from '~/types'
import type { HasOrigin } from '~/utils/entityGroups'

/**
 * Agents, commands and skills as one thing, because they answer one question.
 *
 * They had a page each — a card grid, grouped rows and a dense table — and the
 * split is the system's, not yours. Nobody arrives wondering "is what I need an
 * agent or a skill"; they arrive wondering what Claude can do about the thing in
 * front of them. Eleven agents, thirty-seven commands and a hundred and
 * ninety-nine skills are one searchable list with a facet, not three
 * destinations to guess between.
 *
 * MCP servers now share the Library *page* but not this list. They were their
 * own nav item for a slice of the same question, so the page took them on as a
 * facet after a divider — but a server is a live connection with a health state
 * and a sign-in button, not a file you wrote and can open, so it is not a fourth
 * `CapabilityType`. See `McpServerList`.
 *
 * Plugins deliberately stay where they are: a plugin is a *source* of these, and
 * is already how this list is grouped.
 */

export type CapabilityType = 'agent' | 'command' | 'skill'

export interface Capability extends HasOrigin {
  type: CapabilityType
  /** Unique across types: a command and a skill may share a slug. */
  key: string
  slug: string
  to: string
  /** What it is called, or how it is typed — an invocation for a command. */
  name: string
  description?: string
  /** Set in mono for commands, because you type them rather than read them. */
  mono: boolean
  /** A command's argument hint, or the context a skill applies in. */
  hint?: string
  /** An agent's model tier. */
  model?: string
  /** An agent's identity colour. */
  colour?: string
  /** The agent a skill is bound to. */
  boundAgent?: string
  /** How many tools an agent may reach. */
  toolCount?: number
}

export const CAPABILITY_LOOK: Record<CapabilityType, { icon: string; label: string; plural: string }> = {
  agent: { icon: 'i-lucide-cpu', label: 'Agent', plural: 'Agents' },
  command: { icon: 'i-lucide-terminal', label: 'Command', plural: 'Commands' },
  skill: { icon: 'i-lucide-sparkles', label: 'Skill', plural: 'Skills' },
}

/**
 * A frontmatter field as one line of display text.
 *
 * `argument-hint: [--since YYYY-MM-DD]` is valid authoring and arrives as an
 * array, against a type that promises a string. Three of this machine's
 * thirty-seven commands are written that way.
 */
function oneLine(field: unknown): string | undefined {
  if (typeof field === 'string') return field || undefined
  if (Array.isArray(field)) return field.filter(Boolean).join(' ') || undefined
  return undefined
}

export function toCapabilities(
  agents: Agent[],
  commands: Command[],
  skills: Skill[],
): Capability[] {
  const out: Capability[] = []

  for (const agent of agents) {
    out.push({
      type: 'agent',
      key: `agent:${agent.slug}`,
      slug: agent.slug,
      to: `/agents/${agent.slug}`,
      name: agent.frontmatter.name,
      description: oneLine(agent.frontmatter.description),
      mono: false,
      model: agent.frontmatter.model,
      colour: agent.frontmatter.color,
      toolCount: agent.frontmatter.tools?.length,
      scope: agent.scope,
      source: agent.source,
      pluginId: agent.pluginId,
      pluginName: agent.pluginName,
    })
  }

  for (const command of commands) {
    out.push({
      type: 'command',
      key: `command:${command.slug}`,
      slug: command.slug,
      to: `/commands/${command.slug}`,
      // The invocation, not the bare name: `/defender:pickup` is what you type.
      name: command.invocation,
      description: oneLine(command.frontmatter.description),
      mono: true,
      hint: oneLine(command.frontmatter['argument-hint']),
      scope: command.scope,
      source: command.source,
      pluginId: command.pluginId,
      pluginName: command.pluginName,
    })
  }

  for (const skill of skills) {
    out.push({
      type: 'skill',
      key: `skill:${skill.slug}`,
      slug: skill.slug,
      to: `/skills/${skill.slug}`,
      name: skill.frontmatter.name,
      description: oneLine(skill.frontmatter.description),
      mono: false,
      hint: oneLine(skill.frontmatter.context),
      boundAgent: oneLine(skill.frontmatter.agent),
      scope: skill.scope,
      source: skill.source,
      pluginId: skill.pluginId,
      pluginName: skill.pluginName,
      githubRepo: skill.githubRepo,
    })
  }

  return out
}

/** What each facet would show, so a facet with nothing behind it can be hidden. */
export function facetCounts(items: Capability[]) {
  return {
    all: items.length,
    agent: items.filter(i => i.type === 'agent').length,
    command: items.filter(i => i.type === 'command').length,
    skill: items.filter(i => i.type === 'skill').length,
  }
}

/**
 * The strings a search looks through. Includes the plugin name, so typing
 * "posthog" finds everything that plugin brought rather than nothing.
 */
export function searchableText(item: Capability): (string | undefined)[] {
  return [item.name, item.description, item.boundAgent, item.pluginName, item.hint]
}
