import type { Relationship } from '~/types'

interface PluginEntry {
  id: string
  name: string
  skills: string[]
  agents?: string[]
  commands?: string[]
}

interface CommandEntry {
  slug: string
  body: string
  frontmatter: Record<string, unknown>
  /** e.g. `/defender:pickup` — used to match references in other files. */
  invocation?: string
}

export function extractRelationships(
  agents: { slug: string; body: string }[],
  commands: CommandEntry[],
  skills: { slug: string; body: string; frontmatter: Record<string, unknown> }[] = [],
  plugins: PluginEntry[] = [],
): Relationship[] {
  const relationships: Relationship[] = []
  const agentNames = new Set(agents.map(a => a.slug))
  const skillSlugs = new Set(skills.map(s => s.slug))
  const seen = new Set<string>()

  function add(rel: Relationship) {
    const key = `${rel.sourceType}:${rel.sourceSlug}->${rel.targetType}:${rel.targetSlug}`
    if (!seen.has(key)) {
      seen.add(key)
      relationships.push(rel)
    }
  }

  for (const cmd of commands) {
    // Check frontmatter agent reference
    const agentRef = cmd.frontmatter.agent as string | undefined
    if (agentRef && agentNames.has(agentRef)) {
      add({
        sourceType: 'command',
        sourceSlug: cmd.slug,
        targetType: 'agent',
        targetSlug: agentRef,
        type: 'agent-frontmatter',
        evidence: `agent: ${agentRef}`,
      })
    }

    // Scan body for subagent_type patterns
    const subagentMatches = cmd.body.matchAll(/subagent_type\s*[:=]\s*["']?([a-z][\w-]*)["']?/gi)
    for (const m of subagentMatches) {
      const name = m[1]
      if (agentNames.has(name)) {
        add({
          sourceType: 'command',
          sourceSlug: cmd.slug,
          targetType: 'agent',
          targetSlug: name,
          type: 'spawns',
          evidence: m[0],
        })
      }
    }

    // Scan body for "spawn/dispatch <agent>" patterns
    const spawnMatches = cmd.body.matchAll(
      /(?:[Ss]pawn(?:s|ed)?|[Dd]ispatch(?:es|ed)?|[Ll]aunch(?:es|ed)?|[Dd]elegates?\s+to)\s+(?:the\s+)?["'`]?([a-z][\w-]*)["'`]?/g
    )
    for (const m of spawnMatches) {
      const name = m[1]
      if (agentNames.has(name)) {
        add({
          sourceType: 'command',
          sourceSlug: cmd.slug,
          targetType: 'agent',
          targetSlug: name,
          type: 'spawns',
          evidence: m[0],
        })
      }
    }

    // Direct agent-name mentions. Hyphenated names are specific enough to be a
    // real reference; single bare words produce too many false positives.
    for (const agentSlug of agentNames) {
      if (!agentSlug.includes('-') || agentSlug.length < 6) continue
      const regex = new RegExp(`\\b${agentSlug.replace(/-/g, '[\\s-]')}\\b`, 'gi')
      if (regex.test(cmd.body)) {
        add({
          sourceType: 'command',
          sourceSlug: cmd.slug,
          targetType: 'agent',
          targetSlug: agentSlug,
          type: 'spawns',
          evidence: `mentions "${agentSlug}"`,
        })
      }
    }
  }

  // Agents referencing commands by their real invocation (`/hd:debug`, `/review`)
  const byInvocation = new Map<string, CommandEntry>()
  for (const cmd of commands) {
    if (cmd.invocation) byInvocation.set(cmd.invocation, cmd)
  }

  for (const agent of agents) {
    const invocationMatches = agent.body.matchAll(/\/([a-z][\w-]*(?::[\w-]+)*)/gi)
    for (const m of invocationMatches) {
      const matchingCmd = byInvocation.get(`/${m[1]}`)
        ?? commands.find(c => c.frontmatter.name === m[1] || c.slug === m[1]!.replace(/:/g, '--'))
      if (matchingCmd) {
        add({
          sourceType: 'agent',
          sourceSlug: agent.slug,
          targetType: 'command',
          targetSlug: matchingCmd.slug,
          type: 'spawned-by',
          evidence: m[0],
        })
      }
    }
  }

  // Skills: check frontmatter.agent reference to link skill -> agent
  for (const skill of skills) {
    const agentRef = skill.frontmatter.agent as string | undefined
    if (agentRef && agentNames.has(agentRef)) {
      add({
        sourceType: 'skill',
        sourceSlug: skill.slug,
        targetType: 'agent',
        targetSlug: agentRef,
        type: 'agent-frontmatter',
        evidence: `agent: ${agentRef}`,
      })
    }

    for (const agentSlug of agentNames) {
      if (!agentSlug.includes('-') || agentSlug.length < 6) continue
      const regex = new RegExp(`\\b${agentSlug.replace(/-/g, '[\\s-]')}\\b`, 'gi')
      if (regex.test(skill.body)) {
        add({
          sourceType: 'skill',
          sourceSlug: skill.slug,
          targetType: 'agent',
          targetSlug: agentSlug,
          type: 'spawns',
          evidence: `mentions "${agentSlug}"`,
        })
      }
    }
  }

  // Plugins own everything they ship
  for (const plugin of plugins) {
    for (const skillName of plugin.skills) {
      if (skillSlugs.has(skillName)) {
        add({
          sourceType: 'plugin',
          sourceSlug: plugin.id,
          targetType: 'skill',
          targetSlug: skillName,
          type: 'spawns',
          evidence: `provides skill "${skillName}"`,
        })
      }
    }

    for (const agentName of plugin.agents ?? []) {
      if (agentNames.has(agentName)) {
        add({
          sourceType: 'plugin',
          sourceSlug: plugin.id,
          targetType: 'agent',
          targetSlug: agentName,
          type: 'spawns',
          evidence: `provides agent "${agentName}"`,
        })
      }
    }

    for (const invocation of plugin.commands ?? []) {
      const cmd = byInvocation.get(invocation)
      if (cmd) {
        add({
          sourceType: 'plugin',
          sourceSlug: plugin.id,
          targetType: 'command',
          targetSlug: cmd.slug,
          type: 'spawns',
          evidence: `provides command "${invocation}"`,
        })
      }
    }
  }

  return relationships
}
