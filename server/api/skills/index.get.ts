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

  return skills.sort((a, b) => a.slug.localeCompare(b.slug))
})
