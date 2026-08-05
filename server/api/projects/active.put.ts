import { setActiveProject } from '../../utils/projects'

/**
 * Switch to a project, or to none at all.
 *
 * `null` is a real answer rather than a missing one: with no project selected
 * the app works against your personal `~/.claude` alone, which is exactly right
 * for editing agents and skills that are not any one repository's.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ path?: string | null }>(event)
  const state = await setActiveProject(body?.path ?? null)
  return { activePath: state.activePath, projects: state.projects }
})
