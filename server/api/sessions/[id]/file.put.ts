import { findSession, patchSession } from '../../../utils/sessions'
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

  // The sessions list reads a worktree's state on a schedule rather than on
  // every poll, and takes a change to the session record as its cue to look
  // again. Without this an edit made here is real on disk and in the diff, but
  // the list goes on reporting the file count it last saw.
  await patchSession(id, { updatedAt: Date.now() })

  return { path: body.path, saved: true }
})
