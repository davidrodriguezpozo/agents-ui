import { getProjectDir } from '../../utils/scope'
import {
  detectSetupCommand, projectSetupStore, setupCommandFor,
  type ProjectSetup,
} from '../../utils/projectSetup'

/**
 * What makes a fresh checkout of this project runnable — and, when nothing has
 * been chosen, what could be inferred, so the choice is a confirmation rather
 * than a blank box.
 */
export default defineEventHandler(async (event) => {
  const dir = (getQuery(event).dir as string) || getProjectDir(event)
  if (!dir) return { dir: null, command: null, source: null, detected: null, configured: null }

  const resolved = await setupCommandFor(dir)
  const stored = (await projectSetupStore.read().catch((): ProjectSetup => ({})))[dir]

  return {
    dir,
    command: resolved?.command ?? null,
    source: resolved?.source ?? null,
    from: resolved?.from ?? null,
    // "Never chosen" and "deliberately turned off" are different answers, and
    // the resolved command alone cannot tell them apart.
    configured: stored ?? null,
    detected: detectSetupCommand(dir),
  }
})
