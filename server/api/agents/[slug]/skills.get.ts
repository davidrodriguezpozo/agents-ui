import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getScopeRoots } from '../../../utils/scope'
import { parseFrontmatter } from '../../../utils/frontmatter'
import { readInstalledPlugins, scanPluginComponents } from '../../../utils/pluginScan'
import type { AgentSkill, SkillFrontmatter } from '~/types'

export default defineEventHandler(async (event) => {
  const agentSlug = getRouterParam(event, 'slug')!
  const results: AgentSkill[] = []
  const roots = getScopeRoots(event)

  // 1. Standalone skills in every scope
  for (const root of roots) {
    const skillsDir = join(root.dir, 'skills')
    if (!existsSync(skillsDir)) continue

    const entries = await readdir(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = join(skillsDir, entry.name, 'SKILL.md')
      if (!existsSync(skillPath)) continue

      const raw = await readFile(skillPath, 'utf-8')
      const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)

      if (frontmatter.agent === agentSlug) {
        results.push({
          slug: entry.name,
          frontmatter: { ...frontmatter, name: frontmatter.name ?? entry.name },
          body,
          filePath: skillPath,
          source: 'standalone',
        })
      }
    }
  }

  // 2. Plugin skills
  const plugins = await readInstalledPlugins(roots[0]!.dir)
  for (const plugin of plugins) {
    const components = await scanPluginComponents(plugin.entry.installPath, plugin.name)
    for (const skill of components.skills) {
      if (skill.frontmatter.agent !== agentSlug) continue
      results.push({
        slug: skill.slug,
        frontmatter: skill.frontmatter,
        body: skill.body,
        filePath: skill.filePath,
        source: 'plugin',
        pluginId: plugin.id,
        pluginName: plugin.name,
      })
    }
  }

  return results.sort((a, b) => a.slug.localeCompare(b.slug))
})
