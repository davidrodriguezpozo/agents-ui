import { getProjectDir } from '../../utils/scope'
import { allowInProject, revokeInProject } from '../../utils/projectRules'

/**
 * Grant or withdraw a permission for a project. Both directions live here
 * because the answer to "should this be remembered" changes its mind often.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ dir?: string; add?: string[]; remove?: string }>(event)
  const dir = body?.dir || getProjectDir(event)

  if (!dir) {
    throw createError({ statusCode: 400, message: 'A project directory is required' })
  }

  if (body?.remove) return { dir, rules: await revokeInProject(dir, body.remove) }

  const add = (body?.add ?? []).filter(rule => typeof rule === 'string' && rule.trim())
  if (!add.length) {
    throw createError({ statusCode: 400, message: 'Nothing to add' })
  }

  return { dir, rules: await allowInProject(dir, add) }
})
