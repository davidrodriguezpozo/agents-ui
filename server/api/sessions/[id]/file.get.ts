import { findSession } from '../../../utils/sessions'
import { readWorkspaceFile } from '../../../utils/workspaceFiles'

/** One file's text, for editing. Refuses anything binary or outsized. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const path = getQuery(event).path as string
  if (!path) throw createError({ statusCode: 400, message: 'A file path is required' })

  return readWorkspaceFile(session.worktreePath, path)
})
