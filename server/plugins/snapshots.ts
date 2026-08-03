import { createSnapshot } from '../utils/snapshots'

/**
 * Keep a recent copy of the state that cannot be rebuilt from anywhere else.
 *
 * One at startup so there is always something to fall back to, then on a timer.
 * Snapshots that would be identical to the last are skipped, so an idle machine
 * does not fill the window with duplicates and rotate the useful ones out.
 */
const INTERVAL_MS = 30 * 60 * 1000

export default defineNitroPlugin((nitro) => {
  let timer: ReturnType<typeof setInterval> | null = null

  const take = async (reason: 'startup' | 'auto') => {
    try {
      const result = await createSnapshot(reason)
      if (result.created) console.log(`[snapshots] wrote ${result.name}`)
    } catch (e) {
      // Usually means a store is unreadable — which is exactly when the
      // existing snapshots matter most, so they are left alone.
      console.error('[snapshots] skipped:', (e as Error).message)
    }
  }

  setTimeout(() => void take('startup'), 3_000)
  timer = setInterval(() => void take('auto'), INTERVAL_MS)

  nitro.hooks.hook('close', () => { if (timer) clearInterval(timer) })
})
