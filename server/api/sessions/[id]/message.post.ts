import { existsSync } from 'node:fs'
import { findSession, patchSession } from '../../../utils/sessions'
import { resolveRunOptionsFor } from '../../../utils/runOptions'
import { createRun, getActive, readRun, type Run } from '../../../utils/runStore'
import { executeRun } from '../../../utils/runner'
import { notify } from '../../../utils/notify'
import { rulesForProject } from '../../../utils/projectRules'
import { permissionModeFor } from '../../../utils/trust'
import { ensureTranscriptFor } from '../../../utils/transcripts'
import { worktreeFingerprint } from '../../../utils/checks'
import { verifySessionAfterTurn } from '../../../utils/sessionChecks'

/**
 * A turn short enough that you never looked away does not warrant a banner —
 * you watched it happen. Past about half a minute you have gone to do
 * something else, which is the moment being told is worth anything.
 */
const WORTH_INTERRUPTING_MS = 30_000

async function announceTurn(title: string, run: Run | null, elapsedMs: number): Promise<void> {
  if (!run) return

  if (run.status === 'failed') {
    await notify('failed', `${title} failed`, run.error || 'The turn ended early.')
    return
  }

  // A stopped turn was stopped by you, a moment ago, on purpose.
  if (run.status === 'cancelled' || elapsedMs < WORTH_INTERRUPTING_MS) return

  await notify('finished', title, run.output || 'Finished with nothing to report.')
}

/**
 * Send a turn to a session.
 *
 * Each turn is a fresh detached run pointed at the session's worktree and
 * resumed onto its SDK session, which is how continuity works — the SDK has no
 * long-lived handle of its own. Everything the run subsystem already does
 * (streaming, replay, permissions, persistence) applies unchanged.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ input: string }>(event)

  if (!body?.input?.trim()) {
    throw createError({ statusCode: 400, message: 'input is required' })
  }

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  if (session.status === 'archived') {
    throw createError({
      statusCode: 409,
      data: { error: 'session_closed', message: 'This session has been closed. Start a new one to keep working.' },
    })
  }

  // Running with a cwd that does not exist silently produces nothing, so refuse
  // rather than appear to work.
  if (!existsSync(session.worktreePath)) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'worktree_missing',
        message: 'This session\'s workspace is no longer on disk. Close the session and start a new one.',
      },
    })
  }

  // A second turn while one is still running would interleave two agents in the
  // same worktree, which is the exact problem sessions exist to prevent.
  const lastRunId = session.runIds.at(-1)
  if (lastRunId) {
    const previous = getActive(lastRunId)?.run ?? await readRun(lastRunId)
    if (previous && (previous.status === 'running' || previous.status === 'queued')) {
      throw createError({
        statusCode: 409,
        data: { error: 'session_busy', message: 'This session is still working. Wait for it to finish or stop it.' },
      })
    }
  }

  // Sessions adopted before this was understood have their conversation only
  // in the repository's transcript directory, where a run in the worktree will
  // never find it. Putting it in place here repairs them on their next turn
  // rather than leaving them permanently unable to resume.
  if (session.adoptedAt && session.sdkSessionId) {
    await ensureTranscriptFor(session.repoDir, session.worktreePath, session.sdkSessionId)
  }

  const options = await resolveRunOptionsFor({
    projectDir: session.worktreePath,
    agentSlug: session.agentSlug,
    // How much this session was told it could do without stopping to ask.
    permissionMode: permissionModeFor(session.trust),
    // What this project has already been trusted with. Without it every
    // session starts from scratch and asks again for approvals given a dozen
    // times before.
    allowRules: await rulesForProject(session.repoDir),
  })

  const run = createRun({
    kind: 'chat',
    title: body.input.trim().slice(0, 70),
    input: body.input.trim(),
    agentSlug: session.agentSlug,
    projectDir: session.worktreePath,
    sessionId: session.id,
  })

  await patchSession(id, {
    status: 'running',
    runIds: [...session.runIds, run.id],
  })

  const startedAt = Date.now()

  // What the workspace looked like before the turn. Comparing against it
  // afterwards is what distinguishes a turn that changed the code from one
  // that answered a question — only the first is worth a test run.
  const fingerprintBefore = await worktreeFingerprint(session.worktreePath)

  void executeRun(run, options, { resumeSessionId: session.sdkSessionId })
    .finally(async () => {
      // The SDK hands back its own id on the first turn; keep it so the next
      // turn resumes rather than starting a new conversation.
      const finished = getActive(run.id)?.run ?? await readRun(run.id)
      await patchSession(id, {
        status: 'idle',
        sdkSessionId: finished?.sdkSessionId ?? session.sdkSessionId,
      })

      await announceTurn(session.title, finished, Date.now() - startedAt)

      // Detached: the checks outlast the turn by minutes, and the session is
      // idle and usable throughout. The verdict lands on the record when it
      // arrives.
      void verifySessionAfterTurn(id, fingerprintBefore)
    })

  return { runId: run.id, sessionId: session.id }
})
