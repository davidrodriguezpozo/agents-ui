import { getProjectDir } from '../../utils/scope'
import { checkCommandFor, clearCheckCommand, setCheckCommand } from '../../utils/checks'

/**
 * Set, clear or turn off this project's checks.
 *
 * An empty command is a real answer — "there is nothing to run here" — and is
 * remembered as one, so a project without tests stops being nagged about it.
 * Resetting forgets the choice entirely and lets detection apply again.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ dir?: string; command?: string; reset?: boolean }>(event)
  const dir = body?.dir || getProjectDir(event)

  if (!dir) {
    throw createError({ statusCode: 400, message: 'A project directory is required' })
  }

  if (body?.reset) {
    await clearCheckCommand(dir)
  } else {
    await setCheckCommand(dir, body?.command ?? '')
  }

  const resolved = await checkCommandFor(dir)
  return { dir, command: resolved?.command ?? null, source: resolved?.source ?? null }
})
