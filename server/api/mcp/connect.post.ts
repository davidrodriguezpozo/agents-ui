import { connectProject } from '../../utils/mcpConnect'
import { normaliseProjectPath, readProjects } from '../../utils/projects'
import { getProjectDir } from '../../utils/scope'

/**
 * Put this app into a project's `.mcp.json`, so nobody has to paste JSON.
 *
 * The repository is checked against the projects this app already knows, the
 * same rule `/api/ledger/sync` and `/api/project/shared` follow: without it this
 * would write a file — containing a token — into any directory a browser cared
 * to name.
 *
 * Answers 200 with a refusal rather than throwing for the two ordinary "no"s, so
 * the panel can print the sentence instead of a stack: a tracked `.mcp.json`,
 * and one that cannot be parsed.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ dir?: string }>(event).catch(() => ({} as { dir?: string }))
  const asked = normaliseProjectPath(body?.dir || getProjectDir(event) || '')

  if (!asked) {
    throw createError({ statusCode: 400, message: 'Pick a project first.' })
  }

  const project = (await readProjects()).find(candidate => candidate.path === asked)
  if (!project) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'unknown_repo',
        message: `${asked} is not one of your projects. Add it on the projects page first.`,
      },
    })
  }

  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/mcp/rpc`

  return { ...(await connectProject(project.path, url)), repoDir: project.path }
})
