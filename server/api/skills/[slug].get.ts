import { readFile } from 'node:fs/promises'
import { parseFrontmatter } from '../../utils/frontmatter'
import { findSkill } from '../../utils/findSkill'
import type { SkillFrontmatter } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const found = await findSkill(event, slug)

  if (!found) {
    throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
  }

  const raw = await readFile(found.skillPath, 'utf-8')
  const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)

  return {
    slug,
    frontmatter: { name: slug, ...frontmatter },
    body,
    filePath: found.skillPath,
    source: found.source,
    scope: found.scope,
    projectDir: found.projectDir,
    pluginId: found.pluginId,
    pluginName: found.pluginName,
    githubRepo: found.githubRepo,
  }
})
