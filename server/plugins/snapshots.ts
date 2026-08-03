import { createSnapshot } from '../utils/snapshots'
import { migrateWorktrees } from '../utils/worktreeMigration'

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

  setTimeout(async () => {
    // Snapshot before moving anything, so the record of where each worktree
    // used to be survives a migration that goes wrong.
    await take('startup')

    try {
      const { moved, failed } = await migrateWorktrees()
      if (moved.length) console.log(`[worktrees] moved ${moved.length} into their repositories`)
      for (const f of failed) console.error(`[worktrees] could not move ${f.id}: ${f.reason}`)
    } catch (e) {
      console.error('[worktrees] migration skipped:', (e as Error).message)
    }
  }, 3_000)
  timer = setInterval(() => void take('auto'), INTERVAL_MS)

  nitro.hooks.hook('close', () => { if (timer) clearInterval(timer) })
})
