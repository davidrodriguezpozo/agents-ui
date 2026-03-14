import { writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveClaudePath } from '../../utils/claudeDir'
import { serializeFrontmatter } from '../../utils/frontmatter'
import type { SkillPayload } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const skillDir = resolveClaudePath('skills', slug)
  const skillPath = join(skillDir, 'SKILL.md')

  if (!existsSync(skillPath)) {
    throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
  }

  const payload = await readBody<SkillPayload>(event)
  const newSlug = payload.frontmatter.name
  const newSkillDir = resolveClaudePath('skills', newSlug)
  const newSkillPath = join(newSkillDir, 'SKILL.md')

  // Handle rename
  if (slug !== newSlug) {
    if (existsSync(newSkillDir)) {
      throw createError({ statusCode: 409, message: `Skill already exists: ${newSlug}` })
    }
    await rename(skillDir, newSkillDir)
  }

  const content = serializeFrontmatter(payload.frontmatter, payload.body)
  await writeFile(newSkillPath, content, 'utf-8')

  return {
    slug: newSlug,
    frontmatter: payload.frontmatter,
    body: payload.body,
    filePath: newSkillPath,
  }
})
