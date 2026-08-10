import { findSkill } from '../../../utils/findSkill'
import { listSkillFiles, requireWritableSkill, writeSkillFile } from '../../../utils/skillFiles'

/**
 * Create or overwrite a supporting file.
 *
 * Returns the whole file list rather than just an acknowledgement: writing
 * `references/api.md` into a skill that had no `references/` created a directory
 * too, and the tree on screen would otherwise be one save behind the disk.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const { path, content } = await readBody<{ path?: string; content?: string }>(event)

  if (!path?.trim()) {
    throw createError({ statusCode: 400, message: 'A file path is required.' })
  }

  const found = await findSkill(event, slug)
  if (!found) {
    throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
  }

  requireWritableSkill(found)
  await writeSkillFile(found.dir, path.trim(), content ?? '')

  return { path: path.trim(), files: await listSkillFiles(found.dir) }
})
