import { existsSync } from 'node:fs'
import { addProject, normaliseProjectPath, setActiveProject } from '../../utils/projects'

/**
 * Add a project, and make it the one you are looking at.
 *
 * Adding and activating are one call because they are one intention every time
 * it comes from the switcher — you pick a directory in order to work in it.
 * `activate: false` is there for the paths that come from somewhere else, like
 * a session started against a repository nobody had registered.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    path?: string
    name?: string
    activate?: boolean
    /** A folder this repository sits inside, to stay readable from sessions. */
    contextDir?: string
  }>(event)

  const path = normaliseProjectPath(body?.path ?? '')
  if (!path) {
    throw createError({
      statusCode: 400,
      message: 'A project needs an absolute path — `/Users/you/code/thing`, or `~/code/thing`.',
    })
  }
  if (!existsSync(path)) {
    throw createError({ statusCode: 400, message: `Nothing is at ${path}.` })
  }

  const project = await addProject(path, body?.name, body?.contextDir)
  if (body?.activate === false) return { project }

  const state = await setActiveProject(path)
  return { project, activePath: state.activePath }
})
