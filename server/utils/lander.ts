import { findSession, patchSession, readSessions, type Session } from './sessions'
import { diffBase, updateFromBase, worktreeStatus } from './worktrees'
import {
  baseCheckoutState, commitSessionWork, driftedCheckout, mergeRefusal, mergedBranches, mergeSession,
  previewMerge,
} from './merge'
import { verifySession } from './sessionChecks'
import { notify } from './notify'
import {
  describeLanding, planLanding, shouldStopRun,
  type LandingInput, type LandingOutcome, type LandingStepResult,
} from './landing'
import {
  newLandingRunId, patchLandingRun, saveLandingRun,
  type LandingRun, type LandingStep,
} from './landingRuns'

/**
 * Putting finished sessions into the base branch, one after another.
 *
 * Sequential is the whole design rather than a shortcut. Every merge moves the
 * base, so the next session is behind the moment the previous one lands, and
 * its verdict — however green — was earned against a branch that no longer
 * exists. Bringing the new base in and running the checks again is the only
 * honest way to merge the second one, and the third, and the sixth. Doing that
 * by hand is why it never gets done.
 *
 * Nothing here overrides a check. Overriding is a decision a person makes
 * about one specific change with reasons; a loop that does it six times while
 * nobody is watching is the opposite of what this is for.
 */

/** One landing at a time per repository — two would race over the same base. */
const landing = new Set<string>()

export function isLanding(repoDir: string): boolean {
  return landing.has(repoDir)
}

function toInput(
  session: Omit<Session, 'landed'> & {
    worktree: Awaited<ReturnType<typeof worktreeStatus>>
    /** What git says now — see `LandingInput.inBase`, which it becomes. */
    inBase: boolean
  },
): LandingInput {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    check: session.check ?? null,
    worktree: session.worktree,
    inBase: session.inBase,
  }
}

/**
 * Fresh worktree state for every session in this repo, which the plan needs.
 *
 * Exported so a page can ask for the plan without starting one. The merge train
 * draws the order landing *will* run in, and re-deriving that on the client is
 * how the picture ends up disagreeing with the button underneath it.
 */
export async function candidatesIn(repoDir: string): Promise<LandingInput[]> {
  const sessions = (await readSessions())
    .filter(s => s.repoDir === repoDir)
    // A review workspace is read-only: it holds a commit rather than a branch,
    // and the commits on the branch it names are the pull request author's. It is
    // refused at the merge either way — see `mergeRefusal` — so listing it in the
    // order things will land in only draws a row that cannot.
    .filter(s => !s.detached)

  // One question for the whole repository rather than one per session, asked
  // against the base as it stands now — which is what makes a session that has
  // already landed drop out of the next plan instead of being re-attempted.
  const merged = await mergedBranches(repoDir, sessions[0]?.baseBranch ?? 'HEAD')

  return Promise.all(sessions.map(async (session) => {
    /*
     * Read before the measurement, because it decides what the measurement is
     * against: a checkout that has moved off its branch cannot be measured from
     * the base its record names. Same read the plan's own refusal uses, so the
     * picture and the button cannot come to different conclusions.
     */
    const drifted = await driftedCheckout(session)

    const worktree = await worktreeStatus(
      session.worktreePath,
      await diffBase({ ...session, checkedOut: drifted }),
      session.baseBranch,
    )

    return toInput({
      ...session,
      worktree,
      // Never claimed while drifted: `ahead` would come from the checkout and
      // `merged` from the branch on record, and a branch nothing ever committed
      // to is trivially contained in its base. See `hasLanded`.
      inBase: !drifted && hasLanded(session.branch, worktree.ahead, merged),
    })
  }))
}

/**
 * Whether this session's work is in the base.
 *
 * Both halves are needed. `merged` alone is true of a branch that never committed
 * anything — its tip *is* the base commit — and calling that "landed" would
 * describe an empty session as a finished one. `ahead` is counted from where it
 * branched, so it answers the other half: did it ever do anything at all.
 */
export function hasLanded(branch: string, ahead: number, merged: Set<string>): boolean {
  return ahead > 0 && merged.has(branch)
}

/**
 * Take one session as far as it will go.
 *
 * Each stage can end the attempt, and every ending is a reported outcome
 * rather than an exception — a session that cannot land is information, not a
 * failure of the run.
 */
async function land(sessionId: string): Promise<LandingStepResult> {
  const session = await findSession(sessionId)
  if (!session) return { id: sessionId, title: sessionId, outcome: 'refused', detail: 'The session is gone.' }

  const head = { id: session.id, title: session.title }

  /*
   * Before anything is written, and before the checks are paid for. A drifted
   * session's commit below would land on a branch its record does not name, and a
   * review session's on somebody else's — and in both cases the merge at the end
   * is refused anyway, after a full test-suite run. The same argument
   * `baseCheckoutState` makes about a dirty base: a refusal you are told about
   * beats one you pay for.
   *
   * `refused` rather than a softer outcome, because nothing further along the
   * queue can fix either one: a drifted session needs a person to say which
   * branch is real, and a review workspace was never going to land.
   */
  const refusal = await mergeRefusal(session)
  if (refusal) return { ...head, outcome: 'refused', detail: refusal.reason }

  // Uncommitted work is still work. Merging without it silently drops whatever
  // the agent had not committed, which is rarely what anybody means.
  await commitSessionWork(session, `${session.title} (uncommitted work)`)

  const status = await worktreeStatus(session.worktreePath, await diffBase(session), session.baseBranch)

  if (status.behind) {
    const update = await updateFromBase(session.worktreePath, session.baseBranch)
    if (update.status === 'conflicted') {
      return { ...head, outcome: 'conflicts', detail: update.message }
    }
    if (update.status === 'refused') {
      return { ...head, outcome: 'update-failed', detail: update.message }
    }
  }

  // Run them again regardless of what the record says. Either the base just
  // moved under this session, or it had no usable verdict to begin with —
  // both mean the only verdict worth having is one taken now.
  const check = await verifySession(session.id)

  if (!check) {
    return { ...head, outcome: 'no-checks', detail: 'This project has no checks, so nothing could vouch for it.' }
  }
  if (check.status === 'failing') {
    return { ...head, outcome: 'checks-failed', detail: `\`${check.command}\` did not pass after updating.` }
  }
  if (check.status === 'errored') {
    return { ...head, outcome: 'checks-failed', detail: 'The checks could not run here, so nothing is known.' }
  }

  const ready = await findSession(session.id) ?? session
  const preview = await previewMerge(ready)

  if (!preview.canMerge) {
    /**
     * Told apart because they mean different things for the rest of the queue: a
     * conflict is this session's problem, a dirty base is everyone's, and work
     * that already landed is nobody's.
     *
     * That last one used to fall through to `refused`, which stops the whole run
     * — so one already-merged session left every session behind it unattempted,
     * on every retry.
     */
    const outcome: LandingOutcome = preview.blockedBy === 'already-landed'
      ? 'already-landed'
      : preview.conflicts.length ? 'conflicts' : 'refused'

    return { ...head, outcome, detail: preview.blockedReason }
  }

  await mergeSession(ready, {})
  await patchSession(session.id, { updatedAt: Date.now() })

  return { ...head, outcome: 'merged' }
}

/**
 * Start a landing run and return its record. Detached: it outlives the
 * request, exactly as a session turn and a workflow run do.
 */
export async function startLanding(repoDir: string, baseBranch: string): Promise<LandingRun> {
  if (landing.has(repoDir)) {
    throw createError({
      statusCode: 409,
      data: { error: 'already_landing', message: 'This project is already landing work.' },
    })
  }

  /**
   * Refused before anything is spent.
   *
   * A dirty base checkout, or one on the wrong branch, blocks every session
   * equally — and this used to be discovered per-session, *after* running that
   * session's checks. So a landing into an uncommitted `main` paid for a full
   * test-suite run, refused, and recorded three more sessions as "not attempted".
   * The condition was knowable for two `git` calls before any of that.
   *
   * Thrown rather than recorded as a failed run: nothing was attempted, so there
   * is no history worth keeping, and a run in the record is a thing the page then
   * has to be dismissed of.
   */
  const base = await baseCheckoutState(repoDir, baseBranch)

  if (base.blockedReason) {
    throw createError({
      statusCode: 409,
      data: { error: 'base_not_ready', message: base.blockedReason },
    })
  }

  const plan = planLanding(await candidatesIn(repoDir))

  if (!plan.queue.length) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'nothing_to_land',
        message: plan.skipped.length
          ? 'Nothing here is ready to land. Every session needs something first.'
          : 'There is nothing to land.',
      },
    })
  }

  const record: LandingRun = {
    id: newLandingRunId(),
    repoDir,
    baseBranch,
    status: 'running',
    steps: plan.queue.map(c => ({
      sessionId: c.id,
      title: c.title,
      need: c.need,
      startedAt: 0,
    })),
    skipped: plan.skipped.map(c => ({ sessionId: c.id, title: c.title, reason: c.reason ?? 'Left alone.' })),
    startedAt: Date.now(),
  }

  await saveLandingRun(record)
  landing.add(repoDir)

  void execute(record).finally(() => landing.delete(repoDir))

  return record
}

async function execute(record: LandingRun): Promise<void> {
  const results: LandingStepResult[] = []
  const steps: LandingStep[] = record.steps.map(s => ({ ...s }))
  let stoppedBy: string | undefined

  try {
    for (const [index, step] of steps.entries()) {
      step.startedAt = Date.now()
      await patchLandingRun(record.id, { steps: [...steps] })

      const result = await land(step.sessionId)
      results.push(result)

      step.outcome = result.outcome
      step.detail = result.detail
      step.endedAt = Date.now()
      await patchLandingRun(record.id, { steps: [...steps] })

      if (shouldStopRun(result.outcome)) {
        stoppedBy = result.detail ?? 'Git would not allow a merge here.'

        // Everything behind it never ran. Saying so beats leaving them blank,
        // which reads as though they were considered and passed over.
        for (const later of steps.slice(index + 1)) {
          later.detail = 'Not attempted — the run stopped before reaching it.'
        }
        break
      }
    }
  } catch (e: any) {
    stoppedBy = e?.data?.message || e?.message || 'The run stopped unexpectedly.'
  }

  const summary = describeLanding(results)

  await patchLandingRun(record.id, {
    steps,
    status: stoppedBy ? 'stopped' : 'completed',
    error: stoppedBy,
    summary,
    endedAt: Date.now(),
  })

  const merged = results.filter(r => r.outcome === 'merged').length
  await notify(
    stoppedBy || merged < results.length ? 'needsYou' : 'finished',
    merged ? `Landed ${merged}` : 'Nothing landed',
    stoppedBy ? `${summary} ${stoppedBy}` : summary,
    // The landing panel, which is where the run it is about is written down.
    '/sessions',
  )
}
