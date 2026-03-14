import { rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolveClaudePath } from '../../utils/claudeDir'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const skillDir = resolveClaudePath('skills', slug)

  if (!existsSync(skillDir)) {
    throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
  }

  await rm(skillDir, { recursive: true })
  return { deleted: true, slug }
})
