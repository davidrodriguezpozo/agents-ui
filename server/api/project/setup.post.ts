import { getProjectDir } from '../../utils/scope'
import { clearSetupCommand, forgetPrepared, setSetupCommand, setupCommandFor } from '../../utils/projectSetup'

/**
 * Set, clear or turn off what prepares this project's workspaces.
 *
 * An empty command is a real answer — "a checkout of this is ready as it is" —
 * and is remembered as one. Resetting forgets the choice and lets detection
 * apply again.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ dir?: string; command?: string; reset?: boolean }>(event)
  const dir = body?.dir || getProjectDir(event)

  if (!dir) {
    throw createError({ statusCode: 400, message: 'A project directory is required' })
  }

  if (body?.reset) {
    await clearSetupCommand(dir)
  } else {
    await setSetupCommand(dir, body?.command ?? '')
  }

  // Workspaces prepared with the old command were prepared with the wrong one.
  // Cheap to forget and expensive to be wrong about.
  forgetPrepared()

  const resolved = await setupCommandFor(dir)
  return { dir, command: resolved?.command ?? null, source: resolved?.source ?? null }
})
