import { findSession } from '../../../utils/sessions'
import { diffBase, worktreeStatus } from '../../../utils/worktrees'
import { getActive, readRun, type RunSummary } from '../../../utils/runStore'
import { steersFromEvents, toolCallsFromEvents } from '../../../utils/turnActivity'
import { checkCommandFor, isStale, worktreeFingerprint } from '../../../utils/checks'
import { branchPullRequest } from '../../../utils/pullRequest'
import { driftedCheckout } from '../../../utils/merge'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  /**
   * Where this session's work actually is, before anything is measured from it.
   *
   * The list endpoint learned this through `worktreeStates`; this one does its
   * own reading and so needed it too — without it the page kept showing the
   * 2,231-file diff the list had stopped showing, which is the worse of the two
   * places to be wrong: the list is a glance, and this is the screen where
   * somebody decides what a session did.
   */
  const driftedTo = await driftedCheckout(session)

  const worktree = await worktreeStatus(
    session.worktreePath,
    await diffBase({ ...session, checkedOut: driftedTo }),
    session.baseBranch,
  )

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
      // What was said into the turn while it ran, and after which step. A
      // steered turn read back without these is a turn that inexplicably
      // changed its mind.
      steers: steersFromEvents(run.events),
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
    /** The branch the worktree is on when the record names another. Usually null. */
    driftedTo,
    /** Null when this project has no checks, which the page says rather than hides. */
    checkCommand: (await checkCommandFor(session.repoDir))?.command ?? null,
    /**
     * The pull request this branch has on GitHub, including one this app never
     * opened. Cached and refreshed behind the answer, so it costs nothing on
     * the poll; null means "none that we know of yet", not "none".
     *
     * Asked about the branch the work is really on: for a drifted session that is
     * `driftedTo`, whose commits are the ones a reader wants the request for. The
     * Work cards match the same way.
     */
    pr: branchPullRequest(session.worktreePath, driftedTo || session.branch),
  }
})
