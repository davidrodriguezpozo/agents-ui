import { closeInterruptedRuns } from '../utils/runStore'
import { readSessions, patchSession } from '../utils/sessions'

/**
 * Tidy up after a restart, before anything else runs.
 *
 * Runs and sessions both keep a status on disk that only means anything while
 * this process is alive. After a restart — a deploy, a crash, a reboot — those
 * say "running" about work that stopped when the process did.
 */
export default defineNitroPlugin(async () => {
  try {
    const closed = await closeInterruptedRuns()
    if (closed) console.log(`[startup] closed ${closed} run${closed === 1 ? '' : 's'} interrupted by a restart`)

    // A session left `running` would refuse the next turn as "still working".
    const sessions = await readSessions().catch(() => [])
    for (const session of sessions) {
      if (session.status === 'running') await patchSession(session.id, { status: 'idle' })
    }
  } catch (e) {
    // Startup housekeeping must never stop the server coming up.
    console.error('[startup] could not tidy interrupted work', e)
  }
})
