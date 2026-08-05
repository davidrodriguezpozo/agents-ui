import { renameProject } from '../../utils/projects'

/**
 * Call a project something other than the last segment of its path.
 *
 * Worth having because that segment is often the least distinguishing part of
 * it: three checkouts of the same repository are three identical rows, and
 * `api` under four different organisations is four.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ path?: string; name?: string }>(event)

  const project = await renameProject(body?.path ?? '', body?.name ?? '')
  if (!project) {
    throw createError({ statusCode: 404, message: 'No such project, or the name was empty.' })
  }

  return { project }
})
