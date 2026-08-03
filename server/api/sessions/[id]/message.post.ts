import { existsSync } from 'node:fs'
import { findSession, patchSession } from '../../../utils/sessions'
import { resolveRunOptionsFor } from '../../../utils/runOptions'
import { createRun, getActive, readRun } from '../../../utils/runStore'
import { executeRun } from '../../../utils/runner'

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

  const options = await resolveRunOptionsFor({
    projectDir: session.worktreePath,
    agentSlug: session.agentSlug,
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

  void executeRun(run, options, { resumeSessionId: session.sdkSessionId })
    .finally(async () => {
      // The SDK hands back its own id on the first turn; keep it so the next
      // turn resumes rather than starting a new conversation.
      const finished = getActive(run.id)?.run ?? await readRun(run.id)
      await patchSession(id, {
        status: 'idle',
        sdkSessionId: finished?.sdkSessionId ?? session.sdkSessionId,
      })
    })

  return { runId: run.id, sessionId: session.id }
})
