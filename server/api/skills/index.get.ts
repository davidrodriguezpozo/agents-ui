import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { resolveClaudePath } from '../../utils/claudeDir'
import { parseFrontmatter } from '../../utils/frontmatter'
import type { Skill, SkillFrontmatter } from '~/types'

interface InstalledEntry {
  installPath: string
  [key: string]: unknown
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    if (!existsSync(path)) return null
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export default defineEventHandler(async () => {
  const skills: Skill[] = []

  // 1. Standalone skills from ~/.claude/skills/
  const skillsDir = resolveClaudePath('skills')
  if (existsSync(skillsDir)) {
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
      })
    }
  }

  // 2. Plugin skills from installed plugins
  const installedPath = resolveClaudePath('plugins', 'installed_plugins.json')
  const installed = await readJson<{ plugins: Record<string, InstalledEntry[]> }>(installedPath)

  if (installed?.plugins) {
    for (const [pluginId, entries] of Object.entries(installed.plugins)) {
      const entry = entries[0]
      if (!entry) continue

      const pluginSkillsDir = join(entry.installPath, 'skills')
      if (!existsSync(pluginSkillsDir)) continue

      const [pluginName] = pluginId.split('@')

      const skillDirs = await readdir(pluginSkillsDir, { withFileTypes: true })
      for (const dir of skillDirs) {
        if (!dir.isDirectory()) continue
        const skillPath = join(pluginSkillsDir, dir.name, 'SKILL.md')
        if (!existsSync(skillPath)) continue

        const raw = await readFile(skillPath, 'utf-8')
        const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)

        skills.push({
          slug: dir.name,
          frontmatter: {
            name: dir.name,
            ...frontmatter,
            // Tag with plugin name as agent if not already set
            agent: frontmatter.agent || pluginName,
          },
          body,
          filePath: skillPath,
        })
      }
    }
  }

  // 3. GitHub-imported skills
  const githubDir = resolveClaudePath('github')
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
