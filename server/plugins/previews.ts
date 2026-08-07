import { stopAllPreviews } from '../utils/preview'
import { onShutdown } from '../utils/shutdown'

/**
 * A preview is spawned detached, in its own process group, so that stopping it
 * can signal the whole group — a dev command is a shell running a package
 * manager running the real server.
 *
 * The cost of detached is that it does not die with this process. Nitro's
 * `close` hook alone was not enough: a plain `kill` never reaches it, and a
 * preview left running when the app was killed kept its port indefinitely.
 */
export default defineNitroPlugin((nitro) => {
  onShutdown(stopAllPreviews)
  nitro.hooks.hook('close', () => stopAllPreviews())
})
