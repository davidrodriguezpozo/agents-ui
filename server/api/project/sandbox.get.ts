import { getProjectDir } from '../../utils/scope'
import { sandboxForProject, sandboxNoticeStore, shouldWarn } from '../../utils/sandbox'
import { readSchedules } from '../../utils/schedules'

/**
 * What this project's runs are allowed to touch.
 *
 * Unlike the check and setup commands there is nothing to detect: an
 * unconfigured project is sandboxed, and `source` is how the page says whether
 * that was chosen or is simply what we do.
 *
 * `warn` is the separate question of whether this project has unattended work
 * that predates the sandbox and has not been told about it.
 */
export default defineEventHandler(async (event) => {
  const dir = (getQuery(event).dir as string) || getProjectDir(event)
  if (!dir) return { dir: null, enabled: null, allowedDomains: [], source: null, warn: false }

  const resolved = await sandboxForProject(dir)

  // Never worth failing the request over — the setting is the answer people
  // came for, and a missing warning is better than a missing page.
  const [rituals, acknowledged] = await Promise.all([
    readSchedules().catch(() => []),
    sandboxNoticeStore.read().catch((): string[] => []),
  ])

  return {
    dir,
    enabled: resolved.enabled,
    allowedDomains: resolved.allowedDomains,
    source: resolved.source,
    from: resolved.from ?? null,
    warn: resolved.enabled && shouldWarn({
      dir,
      source: resolved.source,
      rituals,
      acknowledged: acknowledged.includes(dir),
    }),
  }
})
