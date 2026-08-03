import { findSession } from '../../../utils/sessions'
import { worktreeStatus } from '../../../utils/worktrees'
import { getActive, readRun, type RunSummary } from '../../../utils/runStore'

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
    })
  }

  return { ...session, worktree, turns }
})
