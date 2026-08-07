import { getProjectDir } from '../../utils/scope'
import {
  acknowledgeSandboxNotice, clearProjectSandbox, sandboxForProject, setProjectSandbox,
} from '../../utils/sandbox'

/**
 * Turn this project's sandbox off, or widen it.
 *
 * Resetting forgets the decision entirely, which puts the project back to
 * sandboxed rather than to some remembered middle state — the same shape as
 * resetting a check command, and for the same reason: "I never chose" and "I
 * chose the default" should not be distinguishable later.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    dir?: string
    enabled?: boolean
    allowedDomains?: string[]
    reset?: boolean
    acknowledge?: boolean
  }>(event)
  const dir = body?.dir || getProjectDir(event)

  if (!dir) {
    throw createError({ statusCode: 400, message: 'A project directory is required' })
  }

  // Reading the notice is not the same as choosing anything, so this is
  // recorded separately and deliberately leaves the setting untouched.
  if (body?.acknowledge) {
    await acknowledgeSandboxNotice(dir)
  } else if (body?.reset) {
    await clearProjectSandbox(dir)
  } else {
    await setProjectSandbox(dir, {
      ...(typeof body?.enabled === 'boolean' ? { enabled: body.enabled } : {}),
      ...(Array.isArray(body?.allowedDomains) ? { allowedDomains: body.allowedDomains } : {}),
    })
  }

  const resolved = await sandboxForProject(dir)
  return {
    dir,
    enabled: resolved.enabled,
    allowedDomains: resolved.allowedDomains,
    source: resolved.source,
  }
})
