import { writeFile } from 'node:fs/promises'
import { getScopeRoots } from '../../../utils/scope'
import { serializeFrontmatter } from '../../../utils/frontmatter'
import { readInstalledPlugins, scanPluginComponents } from '../../../utils/pluginScan'
import type { SkillFrontmatter } from '~/types'

export default defineEventHandler(async (event) => {
  const { pluginId, skill, frontmatter, body } = await readBody<{
    pluginId: string
    skill: string
    frontmatter: SkillFrontmatter
    body: string
  }>(event)

  if (!pluginId || !skill) {
    throw createError({ statusCode: 400, message: 'pluginId and skill are required' })
  }

  const roots = getScopeRoots(event)
  const records = await readInstalledPlugins(roots[0]!.dir)
  const record = records.find(r => r.id === pluginId)
  if (!record) {
    throw createError({ statusCode: 404, message: `Plugin not found: ${pluginId}` })
  }

  // Resolve through the scanner so nested and `*-skills/` layouts work too.
  const components = await scanPluginComponents(record.entry.installPath, record.name)
  const match = components.skills.find(s => s.slug === skill)
  if (!match) {
    throw createError({ statusCode: 404, message: `Skill not found: ${skill}` })
  }

  await writeFile(match.filePath, serializeFrontmatter(frontmatter, body), 'utf-8')

  return { ok: true, filePath: match.filePath }
})
