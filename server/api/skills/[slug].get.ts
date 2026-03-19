import { readFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
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

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!

  // 1. Check standalone skills
  const standalonePath = join(resolveClaudePath('skills', slug), 'SKILL.md')
  if (existsSync(standalonePath)) {
    const raw = await readFile(standalonePath, 'utf-8')
    const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)
    return {
      slug,
      frontmatter: { name: slug, ...frontmatter },
      body,
      filePath: standalonePath,
    }
  }

  // 2. Check GitHub-imported skills
  const githubDir = resolveClaudePath('github')
  if (existsSync(githubDir)) {
    const { readImportsRegistry } = await import('../../utils/github')
    const registry = await readImportsRegistry()

    for (const entry of registry.imports) {
      if (!existsSync(entry.localPath)) continue
      const scanRoot = entry.targetPath
        ? join(entry.localPath, entry.targetPath)
        : entry.localPath

      // Recursively search for a SKILL.md in a directory matching the slug
      const findSkill = async (dir: string): Promise<string | null> => {
        if (!existsSync(dir)) return null
        const items = await readdir(dir, { withFileTypes: true })
        for (const item of items) {
          if (!item.isDirectory() || item.name.startsWith('.')) continue
          const fullPath = join(dir, item.name)
          if (item.name === slug) {
            const skillPath = join(fullPath, 'SKILL.md')
            if (existsSync(skillPath)) return skillPath
          }
          const found = await findSkill(fullPath)
          if (found) return found
        }
        return null
      }

      const skillPath = await findSkill(scanRoot)
      if (skillPath) {
        const raw = await readFile(skillPath, 'utf-8')
        const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)
        return {
          slug,
          frontmatter: { name: slug, ...frontmatter },
          body,
          filePath: skillPath,
          source: 'github' as const,
          githubRepo: `${entry.owner}/${entry.repo}`,
        }
      }
    }
  }

  // 3. Check plugin skills
  const installedPath = resolveClaudePath('plugins', 'installed_plugins.json')
  const installed = await readJson<{ plugins: Record<string, InstalledEntry[]> }>(installedPath)

  if (installed?.plugins) {
    for (const entries of Object.values(installed.plugins)) {
      const entry = entries[0]
      if (!entry) continue

      const pluginSkillsDir = join(entry.installPath, 'skills')
      if (!existsSync(pluginSkillsDir)) continue

      const skillPath = join(pluginSkillsDir, slug, 'SKILL.md')
      if (existsSync(skillPath)) {
        const raw = await readFile(skillPath, 'utf-8')
        const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)
        return {
          slug,
          frontmatter: { name: slug, ...frontmatter },
          body,
          filePath: skillPath,
        }
      }
    }
  }

  throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
})
