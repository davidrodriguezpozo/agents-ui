import { stopAllPreviews } from '../utils/preview'

/**
 * A preview is spawned detached, in its own process group, so it survives this
 * process rather than dying with it — which is what makes stopping it reliable
 * and also what would leave one holding a port forever after a restart.
 */
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', () => stopAllPreviews())
})
