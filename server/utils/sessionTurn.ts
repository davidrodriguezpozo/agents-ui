import { existsSync } from 'node:fs'
import { patchSession, type Session } from './sessions'
import { resolveRunOptionsFor } from './runOptions'
import { createRun, getActive, readRun, type Run } from './runStore'
import { executeRun } from './runner'
import { notify } from './notify'
import { rulesForProject } from './projectRules'
import { permissionModeFor } from './trust'
import { ensureTranscriptFor } from './transcripts'
import { checkBudget } from './budget'
import { worktreeFingerprint } from './checks'
import { verifySessionAfterTurn } from './sessionChecks'
import { summariseAfterTurn } from './sessionSummary'

/**
 * Sending a turn to a session.
 *
 * Lives here rather than in the endpoint because a turn is now started from
 * two places: someone typing into a session, and a session being created with
 * something to do. Those must behave identically — the same permissions, the
 * same resume, the same checks afterwards — and the surest way to get that is
 * for there to be one of them.
 */

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
 * Refuse a turn this session cannot take, in words that say what to do about
 * it. Returns null when there is no objection.
 */
export function turnRefusal(session: Session): { error: string; message: string } | null {
  if (session.status === 'archived') {
    return {
      error: 'session_closed',
      message: 'This session has been closed. Start a new one to keep working.',
    }
  }

  // Running with a cwd that does not exist silently produces nothing, so
  // refuse rather than appear to work.
  if (!existsSync(session.worktreePath)) {
    return {
      error: 'worktree_missing',
      message: 'This session\'s workspace is no longer on disk. Close the session and start a new one.',
    }
  }

  return null
}

/**
 * Start a turn and return its run id. The run itself is detached: it outlives
 * the request, streams to whoever is attached, and persists for whoever
 * attaches later.
 */
export async function startTurn(session: Session, input: string): Promise<string> {
  const refusal = turnRefusal(session)
  if (refusal) throw createError({ statusCode: 409, data: refusal })

  // A second turn while one is still running would interleave two agents in
  // the same worktree, which is the exact problem sessions exist to prevent.
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

  // Refused before the workspace is touched and before anything is spent, so
  // hitting the daily limit costs nothing and changes nothing.
  const budget = await checkBudget()
  if (!budget.allowed) {
    throw createError({
      statusCode: 429,
      data: { error: 'over_budget', message: budget.reason! },
    })
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
    title: input.trim().slice(0, 70),
    input: input.trim(),
    agentSlug: session.agentSlug,
    projectDir: session.worktreePath,
    sessionId: session.id,
  })

  await patchSession(session.id, {
    status: 'running',
    runIds: [...session.runIds, run.id],
  })

  const startedAt = Date.now()

  // What the workspace looked like before the turn. Comparing against it
  // afterwards is what distinguishes a turn that changed the code from one
  // that answered a question — only the first is worth a test run.
  const fingerprintBefore = await worktreeFingerprint(session.worktreePath)

  void executeRun(run, options, {
    resumeSessionId: session.sdkSessionId,
    maxBudgetUsd: budget.maxBudgetUsd,
  })
    .finally(async () => {
      // The SDK hands back its own id on the first turn; keep it so the next
      // turn resumes rather than starting a new conversation.
      const finished = getActive(run.id)?.run ?? await readRun(run.id)
      await patchSession(session.id, {
        status: 'idle',
        sdkSessionId: finished?.sdkSessionId ?? session.sdkSessionId,
      })

      await announceTurn(session.title, finished, Date.now() - startedAt)

      // Detached: the checks outlast the turn by minutes, and the session is
      // idle and usable throughout. The verdict lands on the record when it
      // arrives.
      void verifySessionAfterTurn(session.id, fingerprintBefore)

      // Same trigger as the checks, and for the same reason: a turn that
      // changed nothing has nothing to describe. Kept separate from them
      // because a sentence takes seconds and a test suite takes minutes —
      // waiting on the checks would leave the list mute for the whole of it.
      const after = await worktreeFingerprint(session.worktreePath)
      if (after && after !== fingerprintBefore) {
        void summariseAfterTurn(session.id, after)
      }
    })

  return run.id
}
