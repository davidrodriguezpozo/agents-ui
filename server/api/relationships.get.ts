import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { H3Event } from 'h3'
import { getScopeRoots } from '../utils/scope'
import { parseFrontmatter } from '../utils/frontmatter'
import { extractRelationships } from '../utils/relationships'
import { collectAgents, collectCommands } from '../utils/collect'
import { readInstalledPlugins, scanPluginComponents } from '../utils/pluginScan'

interface GraphSkill {
  slug: string
  body: string
  frontmatter: Record<string, unknown>
}

async function loadLocalSkills(event: H3Event): Promise<GraphSkill[]> {
  const skills: GraphSkill[] = []

  for (const root of getScopeRoots(event)) {
    const dir = join(root.dir, 'skills')
    if (!existsSync(dir)) continue

    const entries = await readdir(dir, { withFileTypes: true })
    for (const d of entries) {
      if (!d.isDirectory()) continue
      const skillPath = join(dir, d.name, 'SKILL.md')
      if (!existsSync(skillPath)) continue
      const raw = await readFile(skillPath, 'utf-8')
      const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw)
      skills.push({ slug: d.name, body, frontmatter: { name: d.name, ...frontmatter } })
    }
  }

  return skills
}

export default defineEventHandler(async (event) => {
  const roots = getScopeRoots(event)
  const [agents, commands, localSkills, records] = await Promise.all([
    collectAgents(event),
    collectCommands(event),
    loadLocalSkills(event),
    readInstalledPlugins(roots[0]!.dir),
  ])

  const skills = [...localSkills]
  const plugins = await Promise.all(records.map(async (record) => {
    const components = await scanPluginComponents(record.entry.installPath, record.name)

    for (const skill of components.skills) {
      skills.push({
        slug: skill.slug,
        body: skill.body,
        frontmatter: skill.frontmatter as unknown as Record<string, unknown>,
      })
    }

    return {
      id: record.id,
      name: record.name,
      skills: components.skills.map(s => s.slug),
      agents: components.agents.map(a => a.name),
      commands: components.commands.map(c => c.invocation),
    }
  }))

  return extractRelationships(
    agents.map(a => ({ slug: a.slug, body: a.body })),
    commands.map(c => ({
      slug: c.slug,
      body: c.body,
      frontmatter: c.frontmatter as unknown as Record<string, unknown>,
      invocation: c.invocation,
    })),
    skills,
    plugins,
  )
})
