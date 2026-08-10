import { findSkill } from '../../../utils/findSkill'
import { readSkillFile } from '../../../utils/skillFiles'

/**
 * One supporting file's text: `GET /api/skills/<slug>/files?path=references/api.md`
 *
 * Readable whatever the skill's source. Looking at what a plugin's skill defers
 * to is the main reason to open it at all.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const { path } = getQuery<{ path?: string }>(event)

  if (!path) {
    throw createError({ statusCode: 400, message: 'A file path is required.' })
  }

  const found = await findSkill(event, slug)
  if (!found) {
    throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
  }

  return readSkillFile(found.dir, path)
})
