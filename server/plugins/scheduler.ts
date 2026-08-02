import { startScheduler, stopScheduler } from '../utils/scheduler'

/**
 * Daily rituals only fire while this server is up. That's the tradeoff of a
 * local app — see the README note about running it as a background service.
 */
export default defineNitroPlugin((nitro) => {
  startScheduler()
  nitro.hooks.hook('close', () => stopScheduler())
})
