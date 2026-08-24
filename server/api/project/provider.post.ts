import { getProjectDir } from '../../utils/scope'
import { clearProjectProvider, setProjectProvider } from '../../utils/projectProvider'
import { asProviderId, DEFAULT_PROVIDER, providerFor } from '../../utils/providers'
import { findCursorAgent } from '../../utils/cursorAgentExecutable'
import { findClaude } from '../../utils/cli'

/**
 * Set which agent this project's new sessions start on, or forget the choice.
 *
 * Resetting forgets it entirely rather than writing Claude Code down, which puts
 * the project back to *unset* — the same shape as resetting the sandbox or a
 * check command.
 *
 * **Refused when the binary is not here**, and that is the point of the check
 * rather than a formality: the alternative is a setting that looks saved and
 * then fails on the first turn of every future session in this repository, after
 * a worktree has been cut each time. Answered here as well as in the picker
 * because a setting can outlive the install that justified it.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ dir?: string; provider?: string; reset?: boolean }>(event)
  const dir = body?.dir || getProjectDir(event)

  if (!dir) {
    throw createError({ statusCode: 400, message: 'A project directory is required' })
  }

  if (body?.reset) {
    await clearProjectProvider(dir)
    return { dir, provider: DEFAULT_PROVIDER, source: 'default' }
  }

  const provider = asProviderId(body?.provider)
  if (!provider) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'unknown_provider',
        message: `There is no agent called "${body?.provider}".`,
      },
    })
  }

  const installed = provider === 'cursor' ? findCursorAgent() : await findClaude()
  if (!installed) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'provider_missing',
        message: `${providerFor(provider).label} is not installed on this machine, so sessions `
          + 'here could not start on it. Install it first, then set this.',
      },
    })
  }

  await setProjectProvider(dir, provider)
  return { dir, provider, source: 'configured' }
})
