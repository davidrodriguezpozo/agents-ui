import { closeInterruptedRuns } from '../utils/runStore'
import { readSessions, patchSession } from '../utils/sessions'
import { closeInterruptedWorkflowRuns } from '../utils/workflowRuns'
import { closeInterruptedLandingRuns } from '../utils/landingRuns'
import { resumeInterruptedRituals } from '../utils/restartRecovery'

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
    if (closed.length) {
      console.log(`[startup] closed ${closed.length} run${closed.length === 1 ? '' : 's'} interrupted by a restart`)
    }

    // A ritual advances its clock the moment it fires, so an interrupted run
    // is an occurrence lost rather than delayed. Putting the clock back is
    // what makes the difference between "the machine restarted overnight" and
    // "there was no briefing this morning and nothing said why".
    await resumeInterruptedRituals(closed)

    // A session left `running` would refuse the next turn as "still working".
    const sessions = await readSessions().catch(() => [])
    for (const session of sessions) {
      if (session.status === 'running') await patchSession(session.id, { status: 'idle' })
    }

    // Same reasoning: a workflow's steps were children of the process that
    // went away, so nothing is going to finish them.
    const workflows = await closeInterruptedWorkflowRuns()
    if (workflows) console.log(`[startup] closed ${workflows} workflow run${workflows === 1 ? '' : 's'} interrupted by a restart`)

    // Merges that already happened are in git and are not in doubt; what is
    // lost is whatever was mid-flight when the process went away.
    const landings = await closeInterruptedLandingRuns()
    if (landings) console.log(`[startup] closed ${landings} landing run${landings === 1 ? '' : 's'} interrupted by a restart`)
  } catch (e) {
    // Startup housekeeping must never stop the server coming up.
    console.error('[startup] could not tidy interrupted work', e)
  }
})
