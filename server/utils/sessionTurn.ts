import { existsSync } from 'node:fs'
import { findSession, patchSession, type Session } from './sessions'
import { resolveRunOptionsFor } from './runOptions'
import { createRun, getActive, readRun, type Run } from './runStore'
import { executeRun } from './runner'
import { notify } from './notify'
import { rulesForProject } from './projectRules'
import { permissionModeFor } from './trust'
import { ensureTranscriptFor } from './transcripts'
import { checkBudget } from './budget'
import { withRunSlot } from './runQueue'
import { worktreeFingerprint } from './checks'
import { verifySessionAfterTurn } from './sessionChecks'
import { summariseAfterTurn } from './sessionSummary'
import { clearRepair, planRepair } from './sessionRepair'
import type { SessionCheck } from './checks'

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
 * What a failing verdict leads to, once the checks are in.
 *
 * Either the session takes another turn at fixing itself, or the failure is
 * somebody's problem and they should be told. Exactly one of those, which is
 * why both live here rather than in the checks.
 *
 * Never throws — everything below this point is detached from a turn that has
 * already finished and been reported.
 */
async function actOnVerdict(sessionId: string, check: SessionCheck | null): Promise<void> {
  try {
    const prompt = await planRepair(sessionId, check)

    if (!prompt) {
      // No repair coming, so a failure now needs a person. Re-read the session:
      // a suite can run for ten minutes and the title, or the session itself,
      // may not be what it was when the turn ended.
      const session = await findSession(sessionId)
      if (session && check?.status === 'failing') {
        await notify(
          'failed',
          `${session.title} — checks failed`,
          `\`${check.command}\` did not pass in this session's workspace.`,
        )
      }
      return
    }

    const session = await findSession(sessionId)
    if (!session) return

    // Everything a person's turn is refused for applies here too — an archived
    // session or a missing workspace is not something to retry into.
    if (turnRefusal(session)) return

    await startTurn(session, prompt, { repair: true })
  } catch (e: any) {
    // The likely one is the daily limit: `startTurn` refuses, and a streak that
    // cannot afford another attempt has ended rather than paused. Recorded on
    // the session so the row says why it stopped instead of looking abandoned.
    const session = await findSession(sessionId)
    if (session?.repair?.state === 'running') {
      await patchSession(sessionId, {
        repair: {
          ...session.repair,
          state: 'gave-up',
          reason: e?.data?.message || 'Could not start another attempt.',
          updatedAt: Date.now(),
        },
      })
    }
  }
}

/**
 * Start a turn and return its run id. The run itself is detached: it outlives
 * the request, streams to whoever is attached, and persists for whoever
 * attaches later.
 *
 * `repair` marks a turn this app decided to send, rather than one a person
 * typed. The difference matters in one place: a turn somebody typed is a new
 * instruction, and ends whatever the session had been doing on its own.
 */
export async function startTurn(
  session: Session,
  input: string,
  opts: { repair?: boolean } = {},
): Promise<string> {
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

  // A fresh instruction supersedes whatever the session was doing unattended.
  // Without this, a streak that gave up an hour ago still counts against the
  // checks that fail after what you have just asked for.
  if (!opts.repair) await clearRepair(session)

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

  const execution = { resumeSessionId: session.sdkSessionId, maxBudgetUsd: budget.maxBudgetUsd }

  // A turn you typed goes now — you are sitting in front of it, and "queued
  // behind a ritual" is a worse experience than a busy machine. A repair turn
  // is nobody's foreground, so it waits its turn like the rest of the
  // unattended work.
  void (opts.repair
    ? withRunSlot(() => executeRun(run, options, execution))
    : executeRun(run, options, execution))
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
      // arrives, and may start the next turn on its own.
      //
      // A turn you stopped by hand does not lead anywhere. You interrupted it
      // deliberately, and having it immediately restart itself to fix what it
      // was halfway through is the opposite of what stopping means.
      if (finished?.status !== 'cancelled') {
        void verifySessionAfterTurn(session.id, fingerprintBefore)
          .then(check => actOnVerdict(session.id, check))
      }

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
