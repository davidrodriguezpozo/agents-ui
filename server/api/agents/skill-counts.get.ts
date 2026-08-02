import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getScopeRoots } from '../../utils/scope'
import { parseFrontmatter } from '../../utils/frontmatter'
import { readInstalledPlugins, scanPluginComponents } from '../../utils/pluginScan'
import type { SkillFrontmatter } from '~/types'

export default defineEventHandler(async (event) => {
  const counts: Record<string, number> = {}

  function increment(agent: string | undefined) {
    if (!agent) return
    counts[agent] = (counts[agent] || 0) + 1
  }

  const roots = getScopeRoots(event)

  // 1. Standalone skills across every scope
  for (const root of roots) {
    const skillsDir = join(root.dir, 'skills')
    if (!existsSync(skillsDir)) continue

    const entries = await readdir(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = join(skillsDir, entry.name, 'SKILL.md')
      if (!existsSync(skillPath)) continue
      const raw = await readFile(skillPath, 'utf-8')
      const { frontmatter } = parseFrontmatter<SkillFrontmatter>(raw)
      increment(frontmatter.agent)
    }
  }

  // 2. Plugin skills
  const plugins = await readInstalledPlugins(roots[0]!.dir)
  for (const plugin of plugins) {
    const components = await scanPluginComponents(plugin.entry.installPath, plugin.name)
    for (const skill of components.skills) {
      increment(skill.frontmatter.agent)
    }
  }

  return counts
})
