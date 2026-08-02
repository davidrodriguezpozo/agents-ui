import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getScopeRoots } from '../utils/scope'
import { parseFrontmatter } from '../utils/frontmatter'
import { collectAgents, collectCommands } from '../utils/collect'
import type { Scope } from '~/types'

interface Suggestion {
  type: 'missing-skill' | 'missing-description' | 'empty-body' | 'orphan-skill'
  severity: 'warning' | 'info'
  message: string
  target: { type: 'agent' | 'command' | 'skill'; slug: string }
  scope?: Scope
}

export default defineEventHandler(async (event) => {
  const suggestions: Suggestion[] = []

  // Only lint what the user can actually fix here — plugin content is read-only.
  const agents = (await collectAgents(event)).filter(a => a.source === 'local')
  const commands = (await collectCommands(event)).filter(c => c.source === 'local')

  const skills: { slug: string; agent?: string; scope: Scope }[] = []
  for (const root of getScopeRoots(event)) {
    const skillsDir = join(root.dir, 'skills')
    if (!existsSync(skillsDir)) continue
    const dirs = await readdir(skillsDir, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      const skillPath = join(skillsDir, d.name, 'SKILL.md')
      if (!existsSync(skillPath)) continue
      const raw = await readFile(skillPath, 'utf-8')
      const { frontmatter } = parseFrontmatter<{ agent?: string }>(raw)
      skills.push({ slug: d.name, agent: frontmatter.agent, scope: root.scope })
    }
  }

  const agentNames = new Set(agents.map(a => a.frontmatter.name))

  for (const agent of agents) {
    const name = agent.frontmatter.name
    if (!agent.body.trim()) {
      suggestions.push({
        type: 'empty-body',
        severity: 'warning',
        message: `Agent "${name}" has no instructions`,
        target: { type: 'agent', slug: agent.slug },
        scope: agent.scope,
      })
    }
    if (!agent.frontmatter.description) {
      suggestions.push({
        type: 'missing-description',
        severity: 'warning',
        message: `Agent "${name}" has no description`,
        target: { type: 'agent', slug: agent.slug },
        scope: agent.scope,
      })
    }

    const agentSkills = skills.filter(s => s.agent === name)
    if (agentSkills.length === 0 && agent.body.length > 100) {
      if (/skill|capability|can also|specialized in/i.test(agent.body)) {
        suggestions.push({
          type: 'missing-skill',
          severity: 'info',
          message: `Agent "${name}" mentions capabilities but has no linked skills`,
          target: { type: 'agent', slug: agent.slug },
          scope: agent.scope,
        })
      }
    }
  }

  for (const skill of skills) {
    if (!skill.agent) {
      suggestions.push({
        type: 'orphan-skill',
        severity: 'info',
        message: `Skill "${skill.slug}" is not linked to any agent`,
        target: { type: 'skill', slug: skill.slug },
        scope: skill.scope,
      })
    } else if (!agentNames.has(skill.agent)) {
      suggestions.push({
        type: 'missing-skill',
        severity: 'warning',
        message: `Skill "${skill.slug}" references agent "${skill.agent}" which doesn't exist`,
        target: { type: 'skill', slug: skill.slug },
        scope: skill.scope,
      })
    }
  }

  for (const cmd of commands) {
    if (!cmd.body.trim()) {
      suggestions.push({
        type: 'empty-body',
        severity: 'warning',
        message: `Command "${cmd.invocation}" has no instructions`,
        target: { type: 'command', slug: cmd.slug },
        scope: cmd.scope,
      })
    }
    if (!cmd.frontmatter.description) {
      suggestions.push({
        type: 'missing-description',
        severity: 'info',
        message: `Command "${cmd.invocation}" has no description`,
        target: { type: 'command', slug: cmd.slug },
        scope: cmd.scope,
      })
    }
  }

  return suggestions
})
