import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveClaudePath } from '../../utils/claudeDir'
import { parseFrontmatter } from '../../utils/frontmatter'
import type { SkillFrontmatter } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const skillPath = join(resolveClaudePath('skills', slug), 'SKILL.md')

  if (!existsSync(skillPath)) {
    throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
  }

  const raw = await readFile(skillPath, 'utf-8')
  const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)

  return {
    slug,
    frontmatter: { name: slug, ...frontmatter },
    body,
    filePath: skillPath,
  }
})
