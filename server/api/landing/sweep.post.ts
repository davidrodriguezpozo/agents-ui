import { describeSweep } from '../../utils/baseSweep'
import { runBaseSweep } from '../../utils/baseSweeper'
import { readSessions } from '../../utils/sessions'
import { getProjectDir } from '../../utils/scope'

/**
 * Bring the base into every session that is behind it.
 *
 * Only ever reached from a press. Nothing schedules this, nothing runs it after
 * a merge on its own, and the reason is the same one the merge button has: a
 * pass that writes to five workspaces is not implied by having merged one.
 *
 * It answers with a row per session rather than a status, because the interesting
 * outcome is per session: three brought forward, one conflicted and now resolving
 * it, one skipped for being mid-turn. A single verdict over that would be either
 * a lie or a shrug.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ dir?: string }>(event).catch(() => ({} as { dir?: string }))
  const repoDir = body?.dir || getProjectDir(event)

  if (!repoDir) {
    throw createError({ statusCode: 400, message: 'A project directory is required' })
  }

  const sessions = (await readSessions()).filter(session => session.repoDir === repoDir)
  const baseBranch = sessions[0]?.baseBranch

  if (!baseBranch) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_base', message: 'No session here names a base branch to bring in.' },
    })
  }

  const { plan, results } = await runBaseSweep(repoDir, baseBranch)

  return { repoDir, baseBranch, plan, results, summary: describeSweep(results) }
})
