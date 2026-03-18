import { writeFile, mkdir, rename, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveClaudePath } from '../../utils/claudeDir'
import { serializeFrontmatter } from '../../utils/frontmatter'
import type { SkillPayload } from '~/types'

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

async function findSkillDir(slug: string): Promise<string | null> {
  // Check standalone
  const standaloneDir = resolveClaudePath('skills', slug)
  if (existsSync(join(standaloneDir, 'SKILL.md'))) return standaloneDir

  // Check plugins
  const installedPath = resolveClaudePath('plugins', 'installed_plugins.json')
  const installed = await readJson<{ plugins: Record<string, InstalledEntry[]> }>(installedPath)
  if (installed?.plugins) {
    for (const entries of Object.values(installed.plugins)) {
      const entry = entries[0]
      if (!entry) continue
      const pluginSkillDir = join(entry.installPath, 'skills', slug)
      if (existsSync(join(pluginSkillDir, 'SKILL.md'))) return pluginSkillDir
    }
  }

  return null
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const skillDir = await findSkillDir(slug)

  if (!skillDir) {
    throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
  }

  const payload = await readBody<SkillPayload>(event)
  const content = serializeFrontmatter(payload.frontmatter, payload.body)

  // For standalone skills, support rename
  const isStandalone = skillDir.startsWith(resolveClaudePath('skills'))
  const newSlug = payload.frontmatter.name

  if (isStandalone && slug !== newSlug) {
    const newSkillDir = resolveClaudePath('skills', newSlug)
    if (existsSync(newSkillDir)) {
      throw createError({ statusCode: 409, message: `Skill already exists: ${newSlug}` })
    }
    await rename(skillDir, newSkillDir)
    const newSkillPath = join(newSkillDir, 'SKILL.md')
    await writeFile(newSkillPath, content, 'utf-8')
    return { slug: newSlug, frontmatter: payload.frontmatter, body: payload.body, filePath: newSkillPath }
  }

  // Write in-place (plugin skills or no rename)
  const skillPath = join(skillDir, 'SKILL.md')
  await writeFile(skillPath, content, 'utf-8')
  return { slug: isStandalone ? newSlug : slug, frontmatter: payload.frontmatter, body: payload.body, filePath: skillPath }
})
