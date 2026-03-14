import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveClaudePath } from '../../utils/claudeDir'
import { parseFrontmatter } from '../../utils/frontmatter'
import type { SkillFrontmatter } from '~/types'

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
  const counts: Record<string, number> = {}

  function increment(agent: string | undefined) {
    if (!agent) return
    counts[agent] = (counts[agent] || 0) + 1
  }

  // 1. Standalone skills
  const skillsDir = resolveClaudePath('skills')
  if (existsSync(skillsDir)) {
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
  const installedPath = resolveClaudePath('plugins', 'installed_plugins.json')
  const installed = await readJson<{ plugins: Record<string, InstalledEntry[]> }>(installedPath)

  if (installed?.plugins) {
    for (const [, entries] of Object.entries(installed.plugins)) {
      const entry = entries[0]
      if (!entry) continue

      const pluginSkillsDir = join(entry.installPath, 'skills')
      if (!existsSync(pluginSkillsDir)) continue

      const skillDirs = await readdir(pluginSkillsDir, { withFileTypes: true })
      for (const dir of skillDirs) {
        if (!dir.isDirectory()) continue
        const skillPath = join(pluginSkillsDir, dir.name, 'SKILL.md')
        if (!existsSync(skillPath)) continue
        const raw = await readFile(skillPath, 'utf-8')
        const { frontmatter } = parseFrontmatter<SkillFrontmatter>(raw)
        increment(frontmatter.agent)
      }
    }
  }

  return counts
})
