import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveClaudePath } from '../../utils/claudeDir'
import { serializeFrontmatter } from '../../utils/frontmatter'
import type { SkillPayload } from '~/types'

export default defineEventHandler(async (event) => {
  const payload = await readBody<SkillPayload>(event)
  const slug = payload.frontmatter.name

  const skillDir = resolveClaudePath('skills', slug)
  const skillPath = join(skillDir, 'SKILL.md')

  if (existsSync(skillPath)) {
    throw createError({ statusCode: 409, message: `Skill already exists: ${slug}` })
  }

  // Ensure skills/ and skills/{name}/ directories exist
  await mkdir(skillDir, { recursive: true })

  const content = serializeFrontmatter(payload.frontmatter, payload.body)
  await writeFile(skillPath, content, 'utf-8')

  return {
    slug,
    frontmatter: payload.frontmatter,
    body: payload.body,
    filePath: skillPath,
  }
})
