import { findSkill } from '../../../utils/findSkill'
import { deleteSkillFile, listSkillFiles, requireWritableSkill } from '../../../utils/skillFiles'

/** Remove a supporting file, or a directory and everything under it. */
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

  requireWritableSkill(found)
  await deleteSkillFile(found.dir, path)

  return { deleted: true, path, files: await listSkillFiles(found.dir) }
})
