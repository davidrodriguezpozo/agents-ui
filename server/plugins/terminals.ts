import { reapIdleTerminals, stopAllTerminals } from '../utils/terminal'
import { onShutdown } from '../utils/shutdown'

/**
 * A shell holds a process, a pty and a scrollback buffer for as long as it
 * lives, and nothing about closing a browser tab tells it to stop — which is
 * deliberate, because a long build should survive navigating away.
 *
 * So they are closed on two occasions instead: when nobody has watched one for
 * half an hour, and when this process goes down however it goes down. An
 * orphaned pty outlives the process that made it.
 */
export default defineNitroPlugin((nitro) => {
  const timer = setInterval(() => {
    const closed = reapIdleTerminals()
    if (closed) console.log(`[terminals] closed ${closed} nobody was watching`)
  }, 5 * 60_000)

  onShutdown(stopAllTerminals)
  nitro.hooks.hook('close', () => {
    clearInterval(timer)
    stopAllTerminals()
  })
})
