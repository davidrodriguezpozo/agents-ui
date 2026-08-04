import { findSession } from '../../../utils/sessions'
import { worktreeStatus } from '../../../utils/worktrees'
import { getActive, readRun, type RunSummary } from '../../../utils/runStore'
import { toolCallsFromEvents } from '../../../utils/turnActivity'
import { checkCommandFor, isStale, worktreeFingerprint } from '../../../utils/checks'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const worktree = await worktreeStatus(session.worktreePath, session.baseSha || session.baseBranch)

  // The turns, oldest first, so the page can render the conversation.
  const turns = []
  for (const runId of session.runIds) {
    const run = getActive(runId)?.run ?? await readRun(runId)
    if (!run) continue
    turns.push({
      id: run.id,
      input: run.input,
      output: run.output,
      status: run.status,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      costUsd: run.stats?.costUsd,
      error: run.error,
      // What it did, not just what it said. A turn read back tomorrow has only
      // its event log to recover this from.
      toolCalls: toolCallsFromEvents(run.events),
    })
  }

  // Only worked out for one session at a time. Fingerprinting hashes the full
  // uncommitted diff, which is far too much to do for every row of a list that
  // polls — and on the list it would rarely say anything, since a turn that
  // changes files re-runs the checks itself.
  const checkStale = session.check
    ? isStale(session.check, await worktreeFingerprint(session.worktreePath))
    : false

  return {
    ...session,
    worktree,
    turns,
    checkStale,
    /** Null when this project has no checks, which the page says rather than hides. */
    checkCommand: (await checkCommandFor(session.repoDir))?.command ?? null,
  }
})
