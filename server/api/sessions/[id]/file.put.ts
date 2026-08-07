import { findSession } from '../../../utils/sessions'
import { writeWorkspaceFile } from '../../../utils/workspaceFiles'

/**
 * Save an edit into the session's workspace.
 *
 * The workspace is a git worktree, so this shows up in the session's diff like
 * anything the agent wrote, and it moves the fingerprint — which is what marks
 * the last check result as describing code that no longer exists. Edit,
 * re-check, land: the loop already existed with a hole where this goes.
 *
 * State-changing, so the same-origin check in front of every request applies:
 * a page you happen to have open cannot post here.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const body = await readBody<{ path?: string; content?: string }>(event)
  if (!body?.path) throw createError({ statusCode: 400, message: 'A file path is required' })
  if (typeof body.content !== 'string') {
    throw createError({ statusCode: 400, message: 'Content must be a string' })
  }

  await writeWorkspaceFile(session.worktreePath, body.path, body.content)
  return { path: body.path, saved: true }
})
