import { getProjectDir } from '../../utils/scope'
import {
  checkCommandFor, detectCheckCommand, projectChecksStore,
  type ProjectChecks,
} from '../../utils/checks'

/**
 * What this project runs to tell whether it works — and, when nothing has been
 * chosen, what could be inferred, so the choice is a confirmation rather than
 * a blank box.
 */
export default defineEventHandler(async (event) => {
  const dir = (getQuery(event).dir as string) || getProjectDir(event)
  if (!dir) return { dir: null, command: null, source: null, detected: null, configured: null }

  const resolved = await checkCommandFor(dir)
  // An unreadable store means "nothing chosen", not a failed request — the
  // detected fallback is still a perfectly good answer to show.
  const stored = (await projectChecksStore.read().catch((): ProjectChecks => ({})))[dir]

  return {
    dir,
    command: resolved?.command ?? null,
    source: resolved?.source ?? null,
    from: resolved?.from ?? null,
    // Distinguishes "never chosen" from "deliberately turned off", which the
    // resolved command alone cannot express.
    configured: stored ?? null,
    detected: detectCheckCommand(dir),
  }
})
