import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveClaudePath } from '../../../utils/claudeDir'
import { parseFrontmatter } from '../../../utils/frontmatter'
import type { SkillFrontmatter } from '~/types'

interface InstalledEntry {
  installPath: string
  [key: string]: unknown
}

interface AgentSkill {
  slug: string
  frontmatter: SkillFrontmatter
  body: string
  filePath: string
  source: 'standalone' | 'plugin'
  pluginId?: string
  pluginName?: string
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

export default defineEventHandler(async (event) => {
  const agentSlug = getRouterParam(event, 'slug')!
  const results: AgentSkill[] = []

  // 1. Search standalone skills
  const skillsDir = resolveClaudePath('skills')
  if (existsSync(skillsDir)) {
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
          frontmatter: { name: entry.name, ...frontmatter },
          body,
          filePath: skillPath,
          source: 'standalone',
        })
      }
    }
  }

  // 2. Search plugin skills
  const installedPath = resolveClaudePath('plugins', 'installed_plugins.json')
  const installed = await readJson<{ plugins: Record<string, InstalledEntry[]> }>(installedPath)

  if (installed?.plugins) {
    for (const [pluginId, entries] of Object.entries(installed.plugins)) {
      const entry = entries[0]
      if (!entry) continue

      const pluginSkillsDir = join(entry.installPath, 'skills')
      if (!existsSync(pluginSkillsDir)) continue

      // Read plugin name
      const pluginJsonPath = join(entry.installPath, '.claude-plugin', 'plugin.json')
      const pluginMeta = await readJson<{ name?: string }>(pluginJsonPath)
      const [fallbackName] = pluginId.split('@')

      const skillDirs = await readdir(pluginSkillsDir, { withFileTypes: true })
      for (const dir of skillDirs) {
        if (!dir.isDirectory()) continue
        const skillPath = join(pluginSkillsDir, dir.name, 'SKILL.md')
        if (!existsSync(skillPath)) continue

        const raw = await readFile(skillPath, 'utf-8')
        const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)

        if (frontmatter.agent === agentSlug) {
          results.push({
            slug: dir.name,
            frontmatter: { name: dir.name, ...frontmatter },
            body,
            filePath: skillPath,
            source: 'plugin',
            pluginId,
            pluginName: pluginMeta?.name ?? fallbackName,
          })
        }
      }
    }
  }

  return results.sort((a, b) => a.slug.localeCompare(b.slug))
})
