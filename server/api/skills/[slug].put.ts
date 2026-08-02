import { writeFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serializeFrontmatter } from '../../utils/frontmatter'
import { findSkill } from '../../utils/findSkill'
import type { SkillPayload } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const found = await findSkill(event, slug)

  if (!found) {
    throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
  }

  const payload = await readBody<SkillPayload>(event)
  const content = serializeFrontmatter(payload.frontmatter, payload.body)
  const newSlug = payload.frontmatter.name

  // Renaming means moving the directory — only safe for skills we own.
  if (found.source === 'local' && slug !== newSlug) {
    const newSkillDir = join(found.dir, '..', newSlug)
    if (existsSync(newSkillDir)) {
      throw createError({ statusCode: 409, message: `Skill already exists: ${newSlug}` })
    }
    await rename(found.dir, newSkillDir)
    const newSkillPath = join(newSkillDir, 'SKILL.md')
    await writeFile(newSkillPath, content, 'utf-8')

    return {
      slug: newSlug,
      frontmatter: payload.frontmatter,
      body: payload.body,
      filePath: newSkillPath,
      source: found.source,
      scope: found.scope,
    }
  }

  await writeFile(found.skillPath, content, 'utf-8')

  return {
    slug: found.source === 'local' ? newSlug : slug,
    frontmatter: payload.frontmatter,
    body: payload.body,
    filePath: found.skillPath,
    source: found.source,
    scope: found.scope,
    pluginId: found.pluginId,
    pluginName: found.pluginName,
  }
})
