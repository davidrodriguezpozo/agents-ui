import { getProjectDir } from '../../utils/scope'
import { clearDevCommand, devCommandFor, setDevCommand } from '../../utils/preview'

/** Set, clear, or turn off this project's dev command. */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ dir?: string; command?: string; reset?: boolean }>(event)
  const dir = body?.dir || getProjectDir(event)

  if (!dir) {
    throw createError({ statusCode: 400, message: 'A project directory is required' })
  }

  if (body?.reset) await clearDevCommand(dir)
  else await setDevCommand(dir, body?.command ?? '')

  const resolved = await devCommandFor(dir)
  return { dir, command: resolved?.command ?? null, source: resolved?.source ?? null }
})
