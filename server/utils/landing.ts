import type { Session } from './sessions'

/**
 * Landing finished work, several sessions at a time.
 *
 * This is the half the app never had. It is very good at starting work — six
 * sessions in parallel, each in its own worktree, each with a verdict — and
 * then leaves you to merge them one page at a time.
 *
 * Doing that by hand is worse than it sounds, because the sessions interact.
 * Six branch from `main` and all go green. You merge the first, and the other
 * five are now verified against a `main` that no longer exists. Git will refuse
 * a textual conflict, but it has nothing to say about the other branch renaming
 * a function this one calls — that merges cleanly and breaks. Doing it properly
 * means, for every session after the first: bring the new base in, run the
 * checks again, and only then merge. Nobody does that six times.
 *
 * So it is done here instead, in order, one at a time. Sequential is not a
 * simplification — each merge moves the base, so the next session's update and
 * re-check are only meaningful once the previous one has landed.
 */

/** What a session needs before it can go in, cheapest first. */
export type LandingNeed =
  | 'ready'      // up to date and green: merge it
  | 'update'     // behind the base: bring it forward, then re-check
  | 'check'      // has changes but no usable verdict
  | 'blocked'    // something a person has to decide

export interface LandingCandidate {
  id: string
  title: string
  need: LandingNeed
  /** Only for `blocked`, in words that say what to do about it. */
  reason?: string
}

export interface LandingShape {
  /** Sessions this run will attempt, in the order it will attempt them. */
  queue: LandingCandidate[]
  /** Left alone, and why. */
  skipped: LandingCandidate[]
}

/** Enough of a session to decide. Kept narrow so this stays testable. */
export interface LandingInput {
  id: string
  title: string
  status: Session['status']
  activity?: string
  check?: { status: string } | null
  checkStale?: boolean
  worktree: { exists: boolean; changedFiles: number; dirty: boolean; ahead: number; behind: number }
}

function needOf(session: LandingInput): LandingCandidate {
  const head = { id: session.id, title: session.title }

  if (session.status === 'archived') {
    return { ...head, need: 'blocked', reason: 'Already closed.' }
  }
  if (!session.worktree.exists) {
    return { ...head, need: 'blocked', reason: 'Its workspace is no longer on disk.' }
  }
  if (session.status === 'running' || session.activity === 'working') {
    return { ...head, need: 'blocked', reason: 'Still working — it would be merged half-done.' }
  }
  if (session.activity === 'awaiting-permission') {
    return { ...head, need: 'blocked', reason: 'Waiting on a permission answer.' }
  }

  // Nothing to bring forward. Not a problem, just not a merge.
  if (!session.worktree.changedFiles && !session.worktree.dirty && !session.worktree.ahead) {
    return { ...head, need: 'blocked', reason: 'Nothing in it to merge.' }
  }

  // A known failure is a decision, not a step: re-running it will fail again,
  // and merging it anyway has to be somebody's explicit choice.
  if (session.check?.status === 'failing') {
    return { ...head, need: 'blocked', reason: 'Its checks fail. Fix it, or merge it by hand.' }
  }
  if (session.check?.status === 'errored') {
    return { ...head, need: 'blocked', reason: 'Its checks could not run, so nothing is known about it.' }
  }

  // Behind first: the update invalidates any verdict anyway, so there is no
  // point distinguishing a stale pass from a fresh one here.
  if (session.worktree.behind) return { ...head, need: 'update' }

  if (session.check?.status === 'passing' && !session.checkStale) return { ...head, need: 'ready' }

  return { ...head, need: 'check' }
}

/**
 * Which sessions to attempt and in what order.
 *
 * Cheapest first, and that ordering is doing real work rather than being tidy.
 * Every merge moves the base, so anything merged early adds a `behind` to
 * everything still queued. Landing the ones that are already up to date and
 * green means their merges happen before anybody has paid for an update, and
 * the sessions that were going to need updating get one update covering all of
 * it rather than one per merge ahead of them.
 */
export function planLanding(sessions: LandingInput[]): LandingShape {
  const order: Record<LandingNeed, number> = { ready: 0, check: 1, update: 2, blocked: 3 }

  const decided = sessions.map(needOf).sort((a, b) => order[a.need] - order[b.need])

  return {
    queue: decided.filter(c => c.need !== 'blocked'),
    skipped: decided.filter(c => c.need === 'blocked'),
  }
}

/** How a single attempt ended, for the record and for the person reading it. */
export type LandingOutcome =
  | 'merged'
  | 'checks-failed'
  | 'conflicts'
  | 'update-failed'
  | 'no-checks'
  | 'refused'

export interface LandingStepResult {
  id: string
  title: string
  outcome: LandingOutcome
  detail?: string
}

/**
 * Whether a failure should stop everything or only this one.
 *
 * Only the states that say something about the repository as a whole stop the
 * run. One session failing its checks after an update is that session's
 * problem — the next one may well be fine, and abandoning four good merges
 * because the third had a bad day is the wrong trade.
 *
 * A refusal is different: it means git would not let anything merge here
 * (a dirty checkout, the wrong branch), which will be just as true for
 * everything behind it.
 */
export function shouldStopRun(outcome: LandingOutcome): boolean {
  return outcome === 'refused'
}

/** What to say when it is over, in one line. */
export function describeLanding(results: LandingStepResult[]): string {
  const merged = results.filter(r => r.outcome === 'merged').length
  const failed = results.filter(r => r.outcome === 'checks-failed').length
  const conflicted = results.filter(r => r.outcome === 'conflicts').length
  const unchecked = results.filter(r => r.outcome === 'no-checks').length

  if (!results.length) return 'Nothing was ready to land.'

  const parts = [merged === 1 ? 'Merged 1 session.' : `Merged ${merged} sessions.`]

  if (failed) parts.push(`${failed} failed ${failed === 1 ? 'its' : 'their'} checks after updating.`)
  if (conflicted) parts.push(`${conflicted} would conflict and ${conflicted === 1 ? 'was' : 'were'} left alone.`)
  if (unchecked) parts.push(`${unchecked} had no checks to run, so ${unchecked === 1 ? 'it was' : 'they were'} not merged.`)

  return parts.join(' ')
}
