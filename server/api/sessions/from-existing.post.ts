import { getProjectDir } from '../../utils/scope'
import { startSessionFromRef } from '../../utils/sessionFromRef'

/**
 * Start a session on a branch or a pull request that already exists.
 *
 * The work is in `startSessionFromRef`, which the reviews page starts sessions
 * through as well.
 *
 * The session comes back with `how` on it — created, continued, or adopted —
 * because asking for a branch something already has a workspace for lands you
 * in that workspace, and a page that says "started" either way is lying about
 * which conversation you are now in.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ ref?: string; repoDir?: string; agentSlug?: string }>(event)
  const repoDir = body?.repoDir || getProjectDir(event)

  if (!repoDir) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_project', message: 'Pick a project folder first.' },
    })
  }

  const { session, how, note } = await startSessionFromRef({
    repoDir,
    ref: body?.ref ?? '',
    agentSlug: body?.agentSlug,
  })

  return { ...session, how, note }
})
