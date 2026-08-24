import { getProjectDir } from '../../utils/scope'
import { projectProviderStore } from '../../utils/projectProvider'
import { asProviderId, DEFAULT_PROVIDER } from '../../utils/providers'

/**
 * Which agent this project's new sessions start on.
 *
 * `source` is how the page says whether that was chosen or is simply what we do,
 * the same distinction the sandbox setting draws — and for the same reason: "I
 * never chose" and "I chose the default" have to stay tellable apart, or Reset
 * disappears for everyone who never set anything.
 */
export default defineEventHandler(async (event) => {
  const dir = (getQuery(event).dir as string) || getProjectDir(event)
  if (!dir) return { dir: null, provider: DEFAULT_PROVIDER, source: null }

  // Never worth failing over: the answer is Claude Code either way, and a
  // settings page that will not load over a preferences file is worse.
  const filed = await projectProviderStore.read().catch(() => ({} as Record<string, string>))
  const configured = asProviderId(filed[dir])

  return {
    dir,
    provider: configured ?? DEFAULT_PROVIDER,
    source: configured ? 'configured' : 'default',
  }
})
