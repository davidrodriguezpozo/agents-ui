import { getProjectDir } from '../../utils/scope'
import { detectDevCommand, devCommandFor, projectDevStore, type ProjectDev } from '../../utils/preview'

/**
 * What this project runs to show itself — and, when nothing has been chosen,
 * what could be inferred, so the choice is a confirmation rather than a blank.
 */
export default defineEventHandler(async (event) => {
  const dir = (getQuery(event).dir as string) || getProjectDir(event)
  if (!dir) return { dir: null, command: null, source: null, detected: null, configured: null }

  const resolved = await devCommandFor(dir)
  const stored = (await projectDevStore.read().catch((): ProjectDev => ({})))[dir]

  return {
    dir,
    command: resolved?.command ?? null,
    source: resolved?.source ?? null,
    from: resolved?.from ?? null,
    // "Never chosen" and "deliberately turned off" are different answers.
    configured: stored ?? null,
    detected: detectDevCommand(dir),
  }
})
