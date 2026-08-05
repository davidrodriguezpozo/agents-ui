import { readProjectState, removeProject } from '../../utils/projects'

/**
 * Take a project off the list. Nothing on disk is touched — not the repository,
 * not its worktrees, not the sessions that branched from it.
 *
 * A POST rather than a DELETE because the thing being deleted is identified by
 * an absolute path, and a path does not survive being a URL segment.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ path?: string }>(event)

  const removed = await removeProject(body?.path ?? '')
  const state = await readProjectState()

  return { removed, activePath: state.activePath, projects: state.projects }
})
