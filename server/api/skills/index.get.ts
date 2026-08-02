import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getScopeRoots } from '../../utils/scope'
import { parseFrontmatter } from '../../utils/frontmatter'
import { readInstalledPlugins, scanPluginComponents } from '../../utils/pluginScan'
import type { Skill, SkillFrontmatter } from '~/types'

export default defineEventHandler(async (event) => {
  const skills: Skill[] = []
  const roots = getScopeRoots(event)

  // 1. Standalone skills from every scope's skills/ directory
  for (const root of roots) {
    const skillsDir = join(root.dir, 'skills')
    if (!existsSync(skillsDir)) continue

    const entries = await readdir(skillsDir, { withFileTypes: true })
    for (const dir of entries) {
      if (!dir.isDirectory()) continue
      const skillPath = join(skillsDir, dir.name, 'SKILL.md')
      if (!existsSync(skillPath)) continue

      const raw = await readFile(skillPath, 'utf-8')
      const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)

      skills.push({
        slug: dir.name,
        frontmatter: { name: dir.name, ...frontmatter },
        body,
        filePath: skillPath,
        source: 'local',
        scope: root.scope,
        projectDir: root.projectDir,
      })
    }
  }

  // 2. Plugin skills — including nested groups and `*-skills/` directories
  const plugins = await readInstalledPlugins(roots[0]!.dir)
  for (const plugin of plugins) {
    const components = await scanPluginComponents(plugin.entry.installPath, plugin.name)
    for (const skill of components.skills) {
      skills.push({
        slug: skill.slug,
        frontmatter: skill.frontmatter,
        body: skill.body,
        filePath: skill.filePath,
        source: 'plugin',
        pluginId: plugin.id,
        pluginName: plugin.name,
        readOnly: false,
      })
    }
  }

  // 3. GitHub-imported skills
  const githubDir = join(roots[0]!.dir, 'github')
  if (existsSync(githubDir)) {
    const registry = await readImportsRegistry()

    for (const entry of registry.imports) {
      if (!existsSync(entry.localPath)) continue

      const scanRoot = entry.targetPath
        ? join(entry.localPath, entry.targetPath)
        : entry.localPath

      if (!existsSync(scanRoot)) continue

      const walkForSkills = async (dir: string) => {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const item of entries) {
          if (item.name.startsWith('.')) continue
          const fullPath = join(dir, item.name)
          if (item.isDirectory()) {
            const skillPath = join(fullPath, 'SKILL.md')
            if (existsSync(skillPath)) {
              const raw = await readFile(skillPath, 'utf-8')
              const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)
              if (frontmatter.name && frontmatter.description) {
                if (entry.selectedSkills.length === 0 || entry.selectedSkills.includes(item.name)) {
                  skills.push({
                    slug: item.name,
                    frontmatter: { name: item.name, ...frontmatter },
                    body,
                    filePath: skillPath,
                    source: 'github',
                    githubRepo: `${entry.owner}/${entry.repo}`,
                  })
                }
              }
            }
            await walkForSkills(fullPath)
          }
        }
      }

      await walkForSkills(scanRoot)
    }
  }

  return skills.sort((a, b) => a.slug.localeCompare(b.slug))
})
