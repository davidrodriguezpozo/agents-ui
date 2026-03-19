import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillFrontmatter } from '~/types'

export default defineEventHandler(async (event) => {
  const { owner, repo, selectedSkills } = await readBody<{
    owner: string
    repo: string
    selectedSkills?: string[]
  }>(event)

  const registry = await readImportsRegistry()
  const entry = findImport(registry, owner, repo)

  if (!entry) {
    throw createError({ statusCode: 404, message: 'Import not found' })
  }

  // If selectedSkills provided, update them
  if (selectedSkills !== undefined) {
    entry.selectedSkills = selectedSkills
    await writeImportsRegistry(registry)
    return { entry }
  }

  // Otherwise, scan local clone for all available skills and return them
  const scanRoot = entry.targetPath
    ? join(entry.localPath, entry.targetPath)
    : entry.localPath

  if (!existsSync(scanRoot)) {
    throw createError({ statusCode: 404, message: 'Import directory not found on disk' })
  }

  const availableSkills: { slug: string; name: string; description: string; selected: boolean }[] = []

  const walk = async (dir: string) => {
    const items = await readdir(dir, { withFileTypes: true })
    for (const item of items) {
      if (!item.isDirectory() || item.name.startsWith('.')) continue
      const fullPath = join(dir, item.name)
      const skillPath = join(fullPath, 'SKILL.md')
      if (existsSync(skillPath)) {
        const raw = await readFile(skillPath, 'utf-8')
        const { frontmatter } = parseFrontmatter<SkillFrontmatter>(raw)
        if (frontmatter.name && frontmatter.description) {
          availableSkills.push({
            slug: item.name,
            name: frontmatter.name,
            description: frontmatter.description,
            selected: entry.selectedSkills.length === 0 || entry.selectedSkills.includes(item.name),
          })
        }
      }
      await walk(fullPath)
    }
  }

  await walk(scanRoot)

  return { entry, availableSkills }
})
