import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getRequestScope, resolveForRequest } from '../../utils/scope'
import { serializeFrontmatter } from '../../utils/frontmatter'
import type { SkillPayload } from '~/types'

export default defineEventHandler(async (event) => {
  const payload = await readBody<SkillPayload>(event)
  const scope = getRequestScope(event)
  const slug = payload.frontmatter.name

  const skillDir = resolveForRequest(event, 'skills', slug)
  const skillPath = join(skillDir, 'SKILL.md')

  if (existsSync(skillPath)) {
    throw createError({ statusCode: 409, message: `Skill already exists: ${slug}` })
  }

  await mkdir(skillDir, { recursive: true })

  const content = serializeFrontmatter(payload.frontmatter, payload.body)
  await writeFile(skillPath, content, 'utf-8')

  return {
    slug,
    frontmatter: payload.frontmatter,
    body: payload.body,
    filePath: skillPath,
    source: 'local' as const,
    scope,
  }
})
